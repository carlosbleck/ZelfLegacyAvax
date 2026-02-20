/**
 * ZelfLegacy Backend API
 * Handles vault creation, password share encryption, and IPFS uploads
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const LitManager = require('./lit-manager');
const IPFSManager = require('./ipfs-manager');
const AvalancheManager = require('./avalanche-manager');

const app = express();
const PORT = process.env.PORT || 3000;

// Suppress specific Lit Protocol deprecation warnings
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => {
    if (typeof warning === 'string' && warning.includes('LitErrorKind is deprecated')) {
        return;
    }
    return originalEmitWarning(warning, ...args);
};

// Middleware
app.use(cors());
app.use(express.json());

// Initialize managers
const litManager = new LitManager(process.env.RELAYER_PRIVATE_KEY);
const ipfsManager = new IPFSManager(
    process.env.PINATA_API_KEY,
    process.env.PINATA_SECRET_KEY
);
const avalancheManager = new AvalancheManager(
    process.env.AVALANCHE_RPC_URL || 'http://127.0.0.1:8545',
    process.env.VAULT_REGISTRY_ADDRESS,
    process.env.RELAYER_PRIVATE_KEY
);

/**
 * POST /api/vault/encrypt-shares
 * Encrypts password shares using Lit Protocol and uploads to IPFS
 * 
 * Body:
 * {
 *   "passwordparty": "share1_data",
 *   "passwordlawyer": "share2_data",
 *   "vaultId": "0x123...",
 *   "contractAddress": "0xabc..."
 * }
 */
app.post('/api/vault/encrypt-shares', async (req, res) => {
    try {
        const { passwordparty, passwordlawyer, vaultId, contractAddress } = req.body;

        if (!passwordparty || !passwordlawyer || !vaultId || !contractAddress) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        console.log(`📦 Encrypting shares for vault: ${vaultId}`);

        const officialContractAddress = process.env.VAULT_REGISTRY_ADDRESS;

        // Encrypt both shares with Lit Protocol (access gated by VaultRegistry.isClaimable)
        const encryptedParty = await litManager.encryptPasswordShare(
            passwordparty,
            vaultId,
            officialContractAddress
        );

        const encryptedLawyer = await litManager.encryptPasswordShare(
            passwordlawyer,
            vaultId,
            officialContractAddress
        );

        // Upload encrypted shares to IPFS
        const partyCID = await ipfsManager.uploadEncryptedShare(
            encryptedParty,
            'passwordparty',
            vaultId
        );

        const lawyerCID = await ipfsManager.uploadEncryptedShare(
            encryptedLawyer,
            'passwordlawyer',
            vaultId
        );

        // Create manifest object
        const manifest = JSON.stringify({
            passwordparty: `ipfs://${partyCID}`,
            passwordlawyer: `ipfs://${lawyerCID}`,
        });

        console.log(`🔒 Encrypting manifest for vault: ${vaultId}`);

        // Encrypt the manifest itself (Double Encryption)
        const encryptedManifest = await litManager.encryptPasswordShare(
            manifest,
            vaultId,
            contractAddress
        );

        // Upload encrypted manifest to IPFS
        // We reuse uploadEncryptedShare since the structure { ciphertext, dataToEncryptHash } is exactly what we need
        // equivalent to a "share" but containing the manifest content
        const manifestCID = await ipfsManager.uploadEncryptedShare(
            encryptedManifest,
            'manifest',
            vaultId
        );

        console.log(`✅ Shares & Manifest encrypted and uploaded for vault: ${vaultId}`);

        res.json({
            success: true,
            passwordpartyCID: partyCID,
            passwordlawyerCID: lawyerCID,
            manifestCID: manifestCID,
        });
    } catch (error) {
        console.error('❌ Error encrypting shares:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/vault/decrypt-share
 * Decrypts a password share (requires valid authSig and claimable vault)
 * 
 * Body:
 * {
 *   "cid": "Qm...",
 *   "vaultId": "0x123...",
 *   "contractAddress": "0xabc...",
 *   "authSig": {...}
 * }
 */
app.post('/api/vault/decrypt-share', async (req, res) => {
    try {
        const { cid, vaultId, contractAddress, authSig } = req.body;

        if (!cid || !vaultId || !contractAddress || !authSig) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Verify EIP-191 Signature
        const { ethers } = require('ethers');
        let recoveredAddress;
        try {
            recoveredAddress = ethers.verifyMessage(authSig.signedMessage, authSig.sig);
        } catch (e) {
            return res.status(401).json({ error: 'Invalid signature format' });
        }

        if (recoveredAddress.toLowerCase() !== authSig.address.toLowerCase()) {
            return res.status(401).json({ error: 'Signature address mismatch' });
        }

        // 1.1 Verify Signed Message content to avoid reuse
        if (authSig.signedMessage !== 'Lit Protocol Access') {
            return res.status(401).json({ error: 'Invalid signed message content' });
        }

        // 2. Force use of the official contract address from environment
        const officialContractAddress = process.env.VAULT_REGISTRY_ADDRESS;

        // Verify caller is a beneficiary of this vault on-chain
        const isBen = await avalancheManager.contract.isBeneficiary(vaultId, recoveredAddress);
        if (!isBen) {
            return res.status(403).json({ error: 'Caller is not an authorized beneficiary' });
        }

        console.log(`🔓 Decrypting share from IPFS: ${cid}`);

        // Retrieve encrypted share from IPFS
        const encryptedData = await ipfsManager.retrieve(cid);

        // Decrypt using Lit Protocol
        const decryptedShare = await litManager.decryptPasswordShare(
            encryptedData.ciphertext,
            encryptedData.dataToEncryptHash,
            vaultId,
            officialContractAddress
        );

        console.log(`✅ Share decrypted successfully`);

        res.json({
            success: true,
            passwordShare: decryptedShare,
        });
    } catch (error) {
        console.error('❌ Error decrypting share:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/vault/collect-shares
 * Endpoint for multiparty wills to collect and temporarily store decrypted shares.
 * 
 * Body:
 * {
 *   "vaultId": "0x...",
 *   "beneficiaryAddress": "0x...",
 *   "share": "decrypted_share_data"
 * }
 */
const collectedShares = new Map(); // In-memory store for demo. In production, use DB.

app.post('/api/vault/collect-shares', async (req, res) => {
    try {
        const { vaultId, beneficiaryAddress, share } = req.body;

        if (!vaultId || !beneficiaryAddress || !share) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        console.log(`🤝 Collecting share for vault: ${vaultId} from ${beneficiaryAddress}`);

        if (!collectedShares.has(vaultId)) {
            collectedShares.set(vaultId, []);
        }

        const vaultShares = collectedShares.get(vaultId);

        // Prevent duplicate submissions from the same address if needed, or just append
        vaultShares.push({
            beneficiary: beneficiaryAddress,
            share: share,
            timestamp: Date.now()
        });

        res.json({
            success: true,
            totalCollected: vaultShares.length,
            message: 'Share collected successfully'
        });
    } catch (error) {
        console.error('❌ Error collecting share:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/vault/manifest/:cid
 * Retrieves the password shares manifest from IPFS
 */
app.get('/api/vault/manifest/:cid', async (req, res) => {
    try {
        const { cid } = req.params;
        const manifest = await ipfsManager.retrieve(cid);

        res.json({
            success: true,
            manifest: manifest,
        });
    } catch (error) {
        console.error('❌ Error retrieving manifest:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== AVALANCHE ENDPOINTS =====

/**
 * POST /api/avalanche/create-vault
 * Creates a new inheritance vault on Avalanche
 */
app.post('/api/avalanche/create-vault', async (req, res) => {
    try {
        const {
            testatorMnemonic,
            beneficiaryAddress,
            lawyerAddress,
            heartbeatInterval,
            ipfsCid,
            ipfsCidValidator,
            vaultId
        } = req.body;

        if (!testatorMnemonic || !beneficiaryAddress || !ipfsCid || !ipfsCidValidator) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        console.log(`🏔️ Creating Avalanche vault: ${vaultId}`);

        const result = await avalancheManager.createVault(
            testatorMnemonic,
            vaultId,
            [beneficiaryAddress], // Single beneficiary for now
            lawyerAddress,
            heartbeatInterval || 2592000, // 30 days default
            ipfsCid,
            ipfsCidValidator
        );

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('❌ Error creating Avalanche vault:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/avalanche/update-heartbeat
 * Updates the heartbeat for a vault
 */
app.post('/api/avalanche/update-heartbeat', async (req, res) => {
    try {
        const { testatorMnemonic, vaultId } = req.body;

        if (!testatorMnemonic || !vaultId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        console.log(`💓 Updating heartbeat for vault: ${vaultId}`);

        const result = await avalancheManager.updateHeartbeat(testatorMnemonic, vaultId);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('❌ Error updating heartbeat:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/avalanche/cancel-vault
 * Cancels a vault (testator only)
 */
app.post('/api/avalanche/cancel-vault', async (req, res) => {
    try {
        const { testatorMnemonic, vaultId } = req.body;

        if (!testatorMnemonic || !vaultId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        console.log(`🚫 Cancelling vault: ${vaultId}`);

        const result = await avalancheManager.cancelVault(testatorMnemonic, vaultId);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('❌ Error cancelling vault:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/avalanche/change-lawyer
 * Testator changes the lawyer
 */
app.post('/api/avalanche/change-lawyer', async (req, res) => {
    try {
        const { testatorMnemonic, vaultId, newLawyerAddress } = req.body;

        if (!testatorMnemonic || !vaultId || !newLawyerAddress) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        console.log(`🔄 Changing lawyer for vault: ${vaultId}`);

        const result = await avalancheManager.changeLawyer(testatorMnemonic, vaultId, newLawyerAddress);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('❌ Error changing lawyer:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/avalanche/confirm-death
 * Confirms death (lawyer only).
 * Body: { lawyerMnemonic: string, vaultId: string }
 */
app.post('/api/avalanche/confirm-death', async (req, res) => {
    try {
        // Accept both field names for compatibility
        const lawyerMnemonic = req.body.lawyerMnemonic || req.body.mnemonic;
        const { vaultId } = req.body;

        if (!lawyerMnemonic || !vaultId) {
            return res.status(400).json({ error: 'Missing lawyerMnemonic/mnemonic or vaultId' });
        }

        console.log(`⚰️ Confirming death for vault: ${vaultId}`);

        const result = await avalancheManager.confirmDeath(lawyerMnemonic, vaultId);

        res.json({
            success: true,
            result
        });
    } catch (error) {
        console.error('❌ Error confirming death:', error);
        res.status(500).json({ error: error.message });
    }
});


/**
 * GET /api/avalanche/vault/:vaultId
 * Gets vault data
 */
app.get('/api/avalanche/vault/:vaultId', async (req, res) => {
    try {
        const { vaultId } = req.params;

        console.log(`📖 Getting vault data: ${vaultId}`);

        const vault = await avalancheManager.getVault(vaultId);

        res.json({
            success: true,
            vault: vault
        });
    } catch (error) {
        console.error('❌ Error getting vault:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'ZelfLegacy Backend' });
});

/**
 * GET /api/avalanche/beneficiary-vaults/:address
 * Get all vaults (just IDs) for a beneficiary
 */
app.get('/api/avalanche/beneficiary-vaults/:address', async (req, res) => {
    try {
        const { address } = req.params;

        console.log(`🔍 Fetching vaults for beneficiary: ${address}`);

        const vaultIds = await avalancheManager.getBeneficiaryVaults(address);

        res.json({
            success: true,
            vaultIds: vaultIds
        });
    } catch (error) {
        console.error('❌ Error fetching beneficiary vaults:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/avalanche/beneficiary-vaults-data/:address
 * Get full vault data objects for all vaults where the given address is a beneficiary.
 * This is used by the Android "Accept Will" screen to display vault details.
 */
app.get('/api/avalanche/beneficiary-vaults-data/:address', async (req, res) => {
    try {
        const { address } = req.params;
        console.log(`🔍 Fetching full vault data for beneficiary: ${address}`);
        const vaults = await avalancheManager.getBeneficiaryVaultsData(address);
        res.json({ success: true, vaults });
    } catch (error) {
        console.error('❌ Error fetching beneficiary vaults data:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/vault/manifest-by-vault/:vaultId
 * Retrieves the raw encrypted manifest JSON from IPFS, using the vaultId to look up
 * the ipfsCidValidator stored on-chain. This allows the Android app to find the
 * Shamir share CIDs (passwordparty, passwordlawyer) without needing Lit Protocol.
 */
app.get('/api/vault/manifest-by-vault/:vaultId', async (req, res) => {
    try {
        const { vaultId } = req.params;
        console.log(`📜 Fetching manifest for vault: ${vaultId}`);

        const vault = await avalancheManager.getVault(vaultId);
        const manifestCID = vault.ipfsCidValidator;

        if (!manifestCID) {
            return res.status(404).json({ error: 'No manifest CID found for this vault' });
        }

        console.log(`📦 Retrieving manifest from IPFS: ${manifestCID}`);
        const manifestData = await ipfsManager.retrieve(manifestCID);

        res.json({
            success: true,
            manifestCID,
            manifest: manifestData
        });
    } catch (error) {
        console.error('❌ Error fetching manifest:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/avalanche/owner-vaults/:address
 * Get all vaults for an owner (testator)
 */
app.get('/api/avalanche/owner-vaults/:address', async (req, res) => {
    try {
        const { address } = req.params;

        console.log(`🔍 Fetching vaults for owner: ${address}`);

        const vaultIds = await avalancheManager.getUserVaults(address);

        res.json({
            success: true,
            vaultIds: vaultIds
        });
    } catch (error) {
        console.error('❌ Error fetching owner vaults:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/avalanche/lawyer-vaults/:address
 * Get all vaults for a specific lawyer
 */
app.get('/api/avalanche/lawyer-vaults/:address', async (req, res) => {
    try {
        const { address } = req.params;
        console.log(`⚖️ Fetching vaults for lawyer: ${address}`);
        const vaultIds = await avalancheManager.getLawyerVaults(address);
        res.json({ success: true, vaultIds });
    } catch (error) {
        console.error('❌ Error fetching lawyer vaults:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/avalanche/execute-vault
 * Executes (marks as claimed) a vault that is in Claimable state.
 * Called after the beneficiary has reconstructed the master password.
 * Body: { beneficiaryMnemonic: string, vaultId: string }
 */
app.post('/api/avalanche/execute-vault', async (req, res) => {
    try {
        const { beneficiaryMnemonic, vaultId } = req.body;
        if (!beneficiaryMnemonic || !vaultId) {
            return res.status(400).json({ error: 'Missing beneficiaryMnemonic or vaultId' });
        }
        console.log(`✅ Executing vault: ${vaultId}`);
        const result = await avalancheManager.executeVault(beneficiaryMnemonic, vaultId);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('❌ Error executing vault:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/avalanche/accept-vault
 * Accept a vault (Lawyer)
 */
app.post('/api/avalanche/accept-vault', async (req, res) => {
    try {
        const { mnemonic, vaultId } = req.body;
        if (!mnemonic || !vaultId) {
            return res.status(400).json({ error: 'Missing mnemonic or vaultId' });
        }
        console.log(`✅ Lawyer accepting vault: ${vaultId}`);
        const result = await avalancheManager.acceptVault(mnemonic, vaultId);
        res.json({ success: true, result });
    } catch (error) {
        console.error('❌ Error accepting vault:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/avalanche/reject-vault
 * Reject a vault (Lawyer)
 */
app.post('/api/avalanche/reject-vault', async (req, res) => {
    try {
        const { mnemonic, vaultId } = req.body;
        if (!mnemonic || !vaultId) {
            return res.status(400).json({ error: 'Missing mnemonic or vaultId' });
        }
        console.log(`🚫 Lawyer rejecting vault: ${vaultId}`);
        const result = await avalancheManager.rejectVault(mnemonic, vaultId);
        res.json({ success: true, result });
    } catch (error) {
        console.error('❌ Error rejecting vault:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server only if run directly
if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 ZelfLegacy Backend running on http://0.0.0.0:${PORT}`);
        console.log(`📡 Lit Protocol: ${process.env.LIT_NETWORK || 'nagaDev'} Network (v8/Naga)`);
        console.log(`📦 IPFS: Pinata Gateway`);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down gracefully...');
        await litManager.disconnect();
        process.exit(0);
    });
}

module.exports = app;
