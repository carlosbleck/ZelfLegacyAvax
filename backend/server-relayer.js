/**
 * ZelfLegacy Minimal Relayer
 *
 * Stripped-down backend that handles transaction broadcasting AND email notifications.
 * All logic (Lit Protocol, IPFS, Shamir, calldata building) has been
 * moved to the Android WebView bundle.
 *
 * The relayer holds the private key, signs transactions, and broadcasts.
 * It also maintains an off-chain registry of vault emails and triggers
 * mail notifications on key state transitions and via cron.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const {
    sendLawyerNewPlan,
    sendTestatorPlanActive,
    sendTestatorGracePeriod,
    sendLawyerLivenessFailed,
    sendBeneficiaryClaimable,
} = require('./services/email');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- Client authentication ---
const LEGACY_CLIENT_SECRET = process.env.LEGACY_CLIENT_SECRET;
const requireClientKey = (req, res, next) => {
    const key = req.headers['x-zelf-client-secret'];
    if (!LEGACY_CLIENT_SECRET || key !== LEGACY_CLIENT_SECRET) {
        return res.status(401).json({ error: 'Invalid or missing client key' });
    }
    next();
};
app.use('/api/', requireClientKey);

// Initialize provider and relayer wallet
const provider = new ethers.JsonRpcProvider(
    process.env.AVALANCHE_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc'
);
const relayerWallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
console.log(`🔑 Relayer wallet: ${relayerWallet.address}`);

// VaultRegistry ABI (subset — only functions we need to decode & query)
const VaultRegistryArtifact = require('../contracts/artifacts/contracts/VaultRegistry.sol/VaultRegistry.json');
const CONTRACT_ABI = VaultRegistryArtifact.abi;
const CONTRACT_ADDRESS = process.env.VAULT_REGISTRY_ADDRESS;
const vaultContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
const iface = new ethers.Interface(CONTRACT_ABI);

// --- Pinata Configuration ---
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;

// --- In-memory Share Store (Replace with DB in production) ---
const collectedShares = {};

// ═══════════════════════════════════════════════════════════════
// Off-chain Email Registry
// Maps vaultId → { lawyerEmail, testatorEmail, beneficiaryEmails: [] }
// ═══════════════════════════════════════════════════════════════
const EMAILS_FILE = path.join(__dirname, 'data/vault_emails.json');
const NOTIFIED_FILE = path.join(__dirname, 'data/notified_events.json');

function loadJSON(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.warn(`⚠️ Could not load ${filePath}:`, e.message);
    }
    return {};
}

function saveJSON(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`❌ Could not save ${filePath}:`, e.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// Helper: decode function selector from calldata
// ═══════════════════════════════════════════════════════════════
function tryDecodeCalldata(calldata) {
    try {
        return iface.parseTransaction({ data: calldata });
    } catch {
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/relay/register-emails
// Store emails for a vault before it is created.
// Android sends this right before calling createVault.
// Body: {
//   vaultId: "0x...",
//   testatorEmail: "...",
//   lawyerEmail: "...",
//   beneficiaryEmails: ["...", "..."],
//   beneficiaryTagNames: ["tag1", "tag2"]   // ZNS tag names for beneficiaries
// }
// ═══════════════════════════════════════════════════════════════
app.post('/api/relay/register-emails', (req, res) => {
    try {
        const { vaultId, testatorEmail, lawyerEmail, beneficiaryEmails, beneficiaryTagNames } = req.body;
        if (!vaultId) {
            return res.status(400).json({ error: 'Missing vaultId' });
        }

        const emails = loadJSON(EMAILS_FILE);
        emails[vaultId] = {
            testatorEmail: testatorEmail || null,
            lawyerEmail: lawyerEmail || null,
            beneficiaryEmails: beneficiaryEmails || [],
            beneficiaryTagNames: beneficiaryTagNames || [],
            registeredAt: new Date().toISOString(),
        };
        saveJSON(EMAILS_FILE, emails);

        console.log(`📋 Registered emails for vault ${vaultId}`);
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Failed to register emails:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/relay/send-tx
// Receives pre-built calldata from the Android WebView, wraps it in a
// transaction signed by the relayer, broadcasts it, and returns the hash.
// Also hooks into state transitions to send email notifications.
// Body: { to: string, calldata: string, value?: string }
// ═══════════════════════════════════════════════════════════════
app.post('/api/relay/send-tx', async (req, res) => {
    try {
        const { to, calldata, value } = req.body;
        if (!to || !calldata) {
            return res.status(400).json({ error: 'Missing required fields: to, calldata' });
        }

        // Decode which function is being called
        const decoded = tryDecodeCalldata(calldata);
        const fnName = decoded?.name || 'unknown';
        console.log(`📡 Relaying tx → ${fnName} (selector: ${calldata.substring(0, 10)}...)`);

        const tx = await relayerWallet.sendTransaction({
            to,
            data: calldata,
            value: value || '0x0',
        });
        console.log(`📤 Tx sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

        // ── Email notification hooks ────────────────────────────────
        // Fire-and-forget: don't let email errors fail the response
        const emailsRegistry = loadJSON(EMAILS_FILE);

        if (decoded) {
            try {
                if (fnName === 'createVault') {
                    // Notification 1: lawyer gets notified of new pending plan
                    const vaultId = decoded.args[1]; // bytes32 vaultId is 2nd arg
                    const vaultIdHex = typeof vaultId === 'bigint'
                        ? '0x' + vaultId.toString(16).padStart(64, '0')
                        : vaultId.toString();
                    const testatorAddress = decoded.args[0]; // address _owner is 1st arg

                    const entry = emailsRegistry[vaultIdHex] || emailsRegistry[vaultId] || null;
                    if (entry?.lawyerEmail) {
                        console.log(`📧 Sending "new plan" email to lawyer ${entry.lawyerEmail}`);
                        sendLawyerNewPlan(entry.lawyerEmail, vaultIdHex, testatorAddress)
                            .catch(e => console.error('❌ Lawyer email failed:', e.message));
                    }

                } else if (fnName === 'acceptVault') {
                    // Notification 2: testator gets notified plan is active
                    const vaultId = decoded.args[0];
                    const vaultIdHex = vaultId.toString();

                    // Look up entry by matching key prefix (contract uses bytes32)
                    const entry = findEmailEntry(emailsRegistry, vaultIdHex);
                    if (entry?.testatorEmail) {
                        console.log(`📧 Sending "plan active" email to testator ${entry.testatorEmail}`);
                        sendTestatorPlanActive(entry.testatorEmail, vaultIdHex)
                            .catch(e => console.error('❌ Testator active email failed:', e.message));
                    }

                } else if (fnName === 'confirmDeath') {
                    // Notification 5: beneficiaries get notified inheritance is claimable
                    const vaultId = decoded.args[0];
                    const vaultIdHex = vaultId.toString();
                    const entry = findEmailEntry(emailsRegistry, vaultIdHex);

                    if (entry && entry.beneficiaryEmails.length > 0) {
                        const tagNames = entry.beneficiaryTagNames || [];
                        const isSingle = entry.beneficiaryEmails.length === 1;

                        for (let i = 0; i < entry.beneficiaryEmails.length; i++) {
                            const email = entry.beneficiaryEmails[i];
                            let tagName = tagNames[i] || vaultIdHex;

                            // Small fix for single beneficiary:
                            // 1. If multiple tagnames provided for single person, pick the one containing "val"
                            // 2. Remove ".zelf" ending
                            if (isSingle) {
                                if (tagNames.length > 1) {
                                    const valTag = tagNames.find(t => t.toLowerCase().includes('val'));
                                    if (valTag) tagName = valTag;
                                }
                                tagName = tagName.replace(/\.zelf$/, '');
                            }

                            console.log(`📧 Sending claimable email to beneficiary ${email} with tag ${tagName}`);
                            sendBeneficiaryClaimable(email, tagName)
                                .catch(e => console.error('❌ Beneficiary email failed:', e.message));
                        }
                    }
                }
            } catch (emailErr) {
                console.error('⚠️ Email hook error (non-fatal):', emailErr.message);
            }
        }

        res.json({ txHash: tx.hash, blockNumber: receipt.blockNumber });
    } catch (error) {
        console.error('❌ Relay error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Helper: find an email registry entry matching a vaultId.
 * Handles both padded bytes32 and short hex representations.
 */
function findEmailEntry(registry, vaultId) {
    if (registry[vaultId]) return registry[vaultId];
    // Try normalizing to lowercase
    const lower = vaultId.toLowerCase();
    for (const [key, val] of Object.entries(registry)) {
        if (key.toLowerCase() === lower) return val;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════
// GET /api/cron/check-vaults
// Cron-job endpoint: iterate registered vaults, check state,
// and send grace-period / liveness-failed notifications.
//
// Recommended schedule: every 6–12 hours for production, now running every minute.
// ═══════════════════════════════════════════════════════════════

/**
 * Reusable function to check vault states and send notifications.
 */
async function performVaultCheck() {
    console.log(`\n🔍 [${new Date().toISOString()}] Cron: checking vault states...`);
    const emailsRegistry = loadJSON(EMAILS_FILE);
    const notified = loadJSON(NOTIFIED_FILE);

    const now = Math.floor(Date.now() / 1000);
    let checked = 0, warned = 0, errors = 0;

    const results = [];

    for (const [vaultId, entry] of Object.entries(emailsRegistry)) {
        checked++;
        try {
            // Fetch live vault state from the contract
            const vault = await vaultContract.getVault(vaultId);
            if (!vault.exists) continue;

            const state = Number(vault.state);
            const lastPing = Number(vault.lastPing);
            const heartbeatInterval = Number(vault.heartbeatInterval);
            const timeSincePing = now - lastPing;
            const fractionElapsed = timeSincePing / heartbeatInterval;

            // VaultState enum: 0=PendingLawyer, 1=Active, 2=Warning, 3=Claimable, 4=Executed, 5=Rejected, 6=Cancelled
            const notifiedKey = (eventName) => `${vaultId}:${eventName}`;

            if (state === 1 || state === 2) {
                // Active or Warning — check if heartbeat is getting close to expiry
                const daysRemaining = Math.max(0, Math.floor((heartbeatInterval - timeSincePing) / 86400));

                // Send grace-period warning when 25% or less of interval remains
                if (fractionElapsed >= 0.75 && !notified[notifiedKey('gracePeriod')]) {
                    if (entry.testatorEmail) {
                        console.log(`⚠️ Vault ${vaultId}: sending grace period warning to testator`);
                        await sendTestatorGracePeriod(entry.testatorEmail, vaultId, daysRemaining)
                            .catch(e => console.error('❌ Grace period email failed:', e.message));
                        notified[notifiedKey('gracePeriod')] = new Date().toISOString();
                        warned++;
                        results.push({ vaultId, action: 'gracePeriodWarning' });
                    }
                }

                // Send "lawyer: liveness failed" when fully expired
                if (fractionElapsed >= 1.0 && !notified[notifiedKey('livenessFailed')]) {
                    if (entry.lawyerEmail) {
                        const testatorAddress = vault.owner;
                        console.log(`🔔 Vault ${vaultId}: sending liveness-failed email to lawyer`);
                        await sendLawyerLivenessFailed(entry.lawyerEmail, vaultId, testatorAddress)
                            .catch(e => console.error('❌ Liveness failed email failed:', e.message));
                        notified[notifiedKey('livenessFailed')] = new Date().toISOString();
                        warned++;
                        results.push({ vaultId, action: 'livenessFailed' });
                    }
                }
            }

            // Reset grace period notification key if testator pinged recently (back to active)
            if (state === 1 && fractionElapsed < 0.5) {
                if (notified[notifiedKey('gracePeriod')] || notified[notifiedKey('livenessFailed')]) {
                    delete notified[notifiedKey('gracePeriod')];
                    delete notified[notifiedKey('livenessFailed')];
                    console.log(`♻️ Vault ${vaultId}: reset notification flags (testator pinged)`);
                }
            }

        } catch (e) {
            console.error(`❌ Error checking vault ${vaultId}:`, e.message);
            errors++;
        }
    }

    saveJSON(NOTIFIED_FILE, notified);
    console.log(`✅ Cron complete: checked=${checked}, notified=${warned}, errors=${errors}`);
    return { checked, notified: warned, errors, actions: results };
}

// Schedule the task to run every minute
cron.schedule('* * * * *', () => {
    performVaultCheck().catch(err => console.error('❌ Scheduled cron failed:', err.message));
});

app.get('/api/cron/check-vaults', async (req, res) => {
    try {
        const result = await performVaultCheck();
        res.json({
            success: true,
            summary: result,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/cron/notification-status
// Returns the current notification tracking state.
// ═══════════════════════════════════════════════════════════════
app.get('/api/cron/notification-status', (req, res) => {
    const emailsRegistry = loadJSON(EMAILS_FILE);
    const notified = loadJSON(NOTIFIED_FILE);
    res.json({
        success: true,
        registeredVaults: Object.keys(emailsRegistry).length,
        notifiedEvents: Object.keys(notified).length,
        notified,
    });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/relay/ipfs-upload
// Proxy for Pinata to keep API keys on server.
// ═══════════════════════════════════════════════════════════════
app.post('/api/relay/ipfs-upload', async (req, res) => {
    try {
        const { data, filename } = req.body;

        const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'pinata_api_key': PINATA_API_KEY,
                'pinata_secret_api_key': PINATA_SECRET_KEY
            },
            body: JSON.stringify({
                pinataContent: data,
                pinataMetadata: { name: filename || 'zelf-data' }
            })
        });

        const rawText = await response.text();

        if (!response.ok) {
            console.error(`❌ Pinata API Error (${response.status}):`, rawText);
            let errMsg = 'Pinata error';
            try {
                const result = JSON.parse(rawText);
                errMsg = result.error ? (typeof result.error === 'object' ? JSON.stringify(result.error) : result.error) : rawText;
            } catch (e) {
                errMsg = rawText;
            }
            throw new Error(errMsg);
        }

        const result = JSON.parse(rawText);
        console.log(`✅ IPFS Proxy Upload successful: ${result.IpfsHash}`);
        res.json({ ipfsHash: result.IpfsHash });
    } catch (error) {
        console.error('❌ Proxy IPFS upload failed:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/relay/collect-share
// Meeting point for beneficiaries on different devices.
// ═══════════════════════════════════════════════════════════════
app.post('/api/relay/collect-share', (req, res) => {
    const { vaultId, beneficiaryAddress, partyShare, lawyerShare } = req.body;

    if (!collectedShares[vaultId]) collectedShares[vaultId] = [];

    // Check if already exists
    const existing = collectedShares[vaultId].find(s => s.beneficiary === beneficiaryAddress);
    if (!existing) {
        collectedShares[vaultId].push({ beneficiary: beneficiaryAddress, partyShare, lawyerShare });
    }

    res.json({ success: true, count: collectedShares[vaultId].length });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/relay/shares/:vaultId
// ═══════════════════════════════════════════════════════════════
app.get('/api/relay/shares/:vaultId', (req, res) => {
    const shares = collectedShares[req.params.vaultId] || [];
    res.json({ shares });
});

// ═══════════════════════════════════════════════════════════════
// GET /health
// ═══════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'ZelfLegacy Relayer', relayer: relayerWallet.address });
});

app.listen(PORT, () => {
    console.log(`🚀 ZelfLegacy Relayer running on port ${PORT}`);
});
