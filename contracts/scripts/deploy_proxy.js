import hre from "hardhat";

async function main() {
    const [deployer] = await hre.ethers.getSigners();

    console.log("Deploying VaultRegistry Proxy with the account:", deployer.address);

    const VaultRegistry = await hre.ethers.getContractFactory("VaultRegistry");

    // Deploy the proxy using UUPS pattern
    // initialize(address _initialOwner)
    const vaultRegistry = await hre.upgrades.deployProxy(VaultRegistry, [deployer.address], {
        kind: 'uups',
        initializer: 'initialize'
    });

    await vaultRegistry.waitForDeployment();

    const proxyAddress = await vaultRegistry.getAddress();
    const implementationAddress = await hre.upgrades.prepareUpgrade(proxyAddress, VaultRegistry);

    console.log("VaultRegistry Proxy deployed to:", proxyAddress);
    console.log("VaultRegistry Implementation deployed to:", implementationAddress);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
