/**
 * ZelfLegacy Minimal Relayer
 *
 * Stripped-down backend that ONLY handles transaction broadcasting.
 * All logic (Lit Protocol, IPFS, Shamir, calldata building) has been
 * moved to the Android WebView bundle.
 *
 * The relayer holds the private key, signs transactions, and broadcasts.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

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

// --- Pinata Configuration ---
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;

// --- In-memory Share Store (Replace with DB in production) ---
const collectedShares = {};

/**
 * POST /api/relay/send-tx
 * Receives pre-built signed calldata from the Android WebView, wraps it in a
 * transaction signed by the relayer, broadcasts it, and returns the hash.
 * Body: { to: string, calldata: string, value?: string }
 */
app.post('/api/relay/send-tx', async (req, res) => {
    try {
        const { to, calldata, value } = req.body;
        if (!to || !calldata) {
            return res.status(400).json({ error: 'Missing required fields: to, calldata' });
        }
        console.log(`📡 Relaying tx to ${to} (selector: ${calldata.substring(0, 10)}...)`);
        const tx = await relayerWallet.sendTransaction({
            to,
            data: calldata,
            value: value || '0x0',
        });
        console.log(`📤 Tx sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
        res.json({ txHash: tx.hash, blockNumber: receipt.blockNumber });
    } catch (error) {
        console.error('❌ Relay error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/relay/ipfs-upload
 * Proxy for Pinata to keep API keys on server.
 */
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

/**
 * POST /api/relay/collect-share
 * Meeting point for beneficiaries on different devices.
 */
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

/**
 * GET /api/relay/shares/:vaultId
 */
app.get('/api/relay/shares/:vaultId', (req, res) => {
    const shares = collectedShares[req.params.vaultId] || [];
    res.json({ shares });
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'ZelfLegacy Relayer', relayer: relayerWallet.address });
});

app.listen(PORT, () => {
    console.log(`🚀 ZelfLegacy Relayer running on port ${PORT}`);
});
