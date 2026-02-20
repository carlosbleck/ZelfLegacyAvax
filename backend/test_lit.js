require('dotenv').config();
const LitManager = require('./lit-manager');
const AvalancheManager = require('./avalanche-manager');
const { ethers } = require('ethers');

async function main() {
    const rpcUrl = process.env.AVALANCHE_RPC_URL;
    const contractAddress = process.env.VAULT_REGISTRY_ADDRESS;
    const privateKey = process.env.RELAYER_PRIVATE_KEY;
    const avaxManager = new AvalancheManager(rpcUrl, contractAddress, privateKey);
    const litManager = new LitManager(privateKey);

    const vaultId = ethers.id("test-decrypt-" + Date.now());
    const testatorMnemonic = ethers.Wallet.createRandom().mnemonic.phrase;
    const lawyerAddress = ethers.Wallet.createRandom().address;
    const beneficiary = ethers.Wallet.createRandom().address;

    console.log("Creating Vault (0 seconds heartbeat to make it instantly claimable after a brief period)...");

    await avaxManager.createVault(
        testatorMnemonic,
        vaultId,
        [beneficiary],
        lawyerAddress,
        2,   // heartbeatInterval must be > 0 
        "ipfs", "ipfs" // ipfsCid and ipfsCidValidator
    );

    console.log("Vault created.");

    // Vault initially is PendingLawyer. We need it Active or Claimable. 
    // Since heartbeat is 0, if PendingLawyer, isClaimable uses (createdAt + heartbeatInterval), so createdAt + 0 = now.
    // So it should be instantly claimable because block.timestamp > createdAt!

    console.log("Checking if claimable:", vaultId);

    function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
    await delay(3000); // Wait for block

    // Connect Lit
    await litManager.connect();
    console.log("Encrypting...");
    const encrypted = await litManager.encryptPasswordShare("secret123", vaultId, contractAddress);

    console.log("Decrypting...");
    try {
        const decrypted = await litManager.decryptPasswordShare(encrypted.ciphertext, encrypted.dataToEncryptHash, vaultId, contractAddress);

        let outputStr = "";
        // v8 returns `decryptedData` (Uint8Array)
        if (decrypted.decryptedData) {
            outputStr = Buffer.from(decrypted.decryptedData).toString('utf-8');
        } else {
            outputStr = decrypted; // if it's already string
        }
        console.log("SUCCESS Decoded string:", outputStr);
    } catch (e) {
        console.error("Decrypt failed:", e);
    }

    await litManager.disconnect();
}
main();
