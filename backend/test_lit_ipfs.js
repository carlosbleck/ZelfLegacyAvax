require('dotenv').config();
const LitManager = require('./lit-manager');
const IPFSManager = require('./ipfs-manager');
const AvalancheManager = require('./avalanche-manager');
const { ethers } = require('ethers');

async function main() {
    const rpcUrl = process.env.AVALANCHE_RPC_URL;
    const contractAddress = process.env.VAULT_REGISTRY_ADDRESS;
    const privateKey = process.env.RELAYER_PRIVATE_KEY;

    const avaxManager = new AvalancheManager(rpcUrl, contractAddress, privateKey);
    const litManager = new LitManager(privateKey);
    const ipfsManager = new IPFSManager(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_KEY);

    const vaultId = ethers.id("test-decrypt-ipfs-" + Date.now());
    const testatorMnemonic = ethers.Wallet.createRandom().mnemonic.phrase;
    const beneficiary = ethers.Wallet.createRandom().address;

    console.log("Creating Vault...");
    await avaxManager.createVault(
        testatorMnemonic, vaultId, [beneficiary], ethers.Wallet.createRandom().address, 2, "ipfs", "ipfs"
    );
    await new Promise(r => setTimeout(r, 3000));

    await litManager.connect();

    console.log("Encrypting dummy manifest...");
    const encryptedManifest = await litManager.encryptPasswordShare(
        JSON.stringify({ party: "mock" }), vaultId, contractAddress
    );

    console.log("Uploading to IPFS...");
    const cid = await ipfsManager.uploadEncryptedShare(encryptedManifest, 'manifest', vaultId);

    console.log("Retrieving from IPFS...");
    const encryptedData = await ipfsManager.retrieve(cid);

    console.log("Decrypting...");
    try {
        const decryptedShare = await litManager.decryptPasswordShare(
            encryptedData.ciphertext,
            encryptedData.dataToEncryptHash,
            vaultId,
            contractAddress
        );
        console.log("Decrypted output:", decryptedShare);
    } catch (error) {
        console.error("FAIL:", error);
    }
    await litManager.disconnect();
}
main().catch(console.error);
