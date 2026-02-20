const hre = require("hardhat");

async function main() {
    const VaultRegistry = await hre.ethers.getContractFactory("VaultRegistry");
    const vault = VaultRegistry.attach("0x9D262070DbEc668B74eE328397F7A217569C69E1");

    const owner = hre.ethers.Wallet.createRandom().address;
    const beneficiary = hre.ethers.Wallet.createRandom().address;
    const lawyer = hre.ethers.Wallet.createRandom().address;
    const vaultId = hre.ethers.id("test-" + Date.now());

    console.log("Creating vault...");
    try {
        const tx = await vault.createVault(
            owner,
            vaultId,
            [beneficiary],
            lawyer,
            2,
            60,
            "ipfs//1",
            "ipfs//2"
        );
        console.log("Tx sent: ", tx.hash);
        const receipt = await tx.wait();
        console.log("Success!", receipt.blockNumber);
    } catch (e) {
        console.error("Error revert string:", e.reason);
        console.error("Error data:", e.data);
    }
}
main().catch(console.error);
