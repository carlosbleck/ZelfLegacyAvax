import hre from "hardhat";

/**
 * Upgrade the VaultRegistry proxy on the target network.
 * Requires:
 *   - PRIVATE_KEY: Owner's private key (upgrade authority)
 *   - VAULT_REGISTRY_ADDRESS: Current proxy address
 *
 * For Fuji: npx hardhat run scripts/upgrade.js --network fuji
 */
async function main() {
    const proxyAddress = process.env.VAULT_REGISTRY_ADDRESS;
    if (!proxyAddress) {
        throw new Error("VAULT_REGISTRY_ADDRESS not set in environment");
    }

    const [deployer] = await hre.ethers.getSigners();
    console.log("Upgrading VaultRegistry proxy with account:", deployer.address);
    console.log("Proxy address:", proxyAddress);

    const VaultRegistry = await hre.ethers.getContractFactory("VaultRegistry");

    const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, VaultRegistry);
    await upgraded.waitForDeployment();

    const implementationAddress = await hre.upgrades.erc1967.getImplementationAddress(proxyAddress);

    console.log("VaultRegistry proxy (unchanged):", proxyAddress);
    console.log("New implementation deployed to:", implementationAddress);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
