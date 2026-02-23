require('dotenv').config();
const AvalancheManager = require('../avalanche-manager');
const { ethers } = require('ethers');

async function main() {
    console.log("Starting Avalanche Manager Integration Test on Fuji...");
    const rpcUrl = process.env.AVALANCHE_RPC_URL;
    const contractAddress = process.env.VAULT_REGISTRY_ADDRESS;
    const privateKey = process.env.RELAYER_PRIVATE_KEY;

    console.log("RPC:", rpcUrl);
    console.log("Contract:", contractAddress);

    const avaxManager = new AvalancheManager(rpcUrl, contractAddress, privateKey);

    // Create a random testator and lawyer
    const testator = ethers.Wallet.createRandom();
    const beneficiary = ethers.Wallet.createRandom();
    const lawyer1 = ethers.Wallet.createRandom();
    const lawyer2 = ethers.Wallet.createRandom();

    const vaultId = ethers.id("integration-test-vault-" + Date.now());

    console.log("1. Creating Vault...");
    await avaxManager.createVault(
        testator.address,
        vaultId,
        [beneficiary.address],
        lawyer1.address,
        60, // 60 seconds heartbeat
        "ipfs://test-cid",
        "ipfs://test-validator"
    );

    console.log("2. Changing Lawyer in Pending state...");
    await avaxManager.changeLawyer(testator.address, vaultId, lawyer2.address);

    console.log("3. Fetching Vault Details...");
    const vault = await avaxManager.getVault(vaultId);
    if (vault.lawyer !== lawyer2.address) {
        throw new Error("Lawyer was not changed! Expected: " + lawyer2.address + " Got: " + vault.lawyer);
    }
    console.log("Vault details verified.");

    console.log("Integration Test Completed Successfully.");
}

main().catch(err => {
    console.error("Integration Test Failed:", err);
    process.exit(1);
});
