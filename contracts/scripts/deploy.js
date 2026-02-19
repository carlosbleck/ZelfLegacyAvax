import hre from "hardhat";

async function main() {
    const [deployer] = await hre.ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);

    const VaultRegistry = await hre.ethers.getContractFactory("VaultRegistry");
    const vaultRegistry = await VaultRegistry.deploy();

    await vaultRegistry.waitForDeployment();

    console.log("VaultRegistry deployed to:", await vaultRegistry.getAddress());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
