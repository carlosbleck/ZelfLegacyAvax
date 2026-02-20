const hre = require("hardhat");

async function main() {
    // Pass the proxy address as an argument
    const proxyAddress = process.env.PROXY_ADDRESS;
    if (!proxyAddress) {
        console.error("Please set PROXY_ADDRESS in your environment or .env");
        process.exit(1);
    }

    console.log("Upgrading VaultRegistry at proxy:", proxyAddress);

    const VaultRegistry = await hre.ethers.getContractFactory("VaultRegistry");

    // Upgrade the proxy
    const upgraded = await hre.upgrades.upgradeProxy(proxyAddress, VaultRegistry);
    await upgraded.waitForDeployment();

    const implementationAddress = await hre.upgrades.prepareUpgrade(proxyAddress, VaultRegistry);

    console.log("VaultRegistry upgraded successfully");
    console.log("New Implementation address:", implementationAddress);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
