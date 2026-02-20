const hre = require("hardhat");

async function main() {
    const VaultRegistry = await hre.ethers.getContractFactory("VaultRegistry");
    const vault = VaultRegistry.attach("0x9D262070DbEc668B74eE328397F7A217569C69E1");

    const owner = hre.ethers.Wallet.createRandom().address;
    const beneficiary = hre.ethers.Wallet.createRandom().address;
    const lawyer1 = hre.ethers.Wallet.createRandom().address;
    const lawyer2 = hre.ethers.Wallet.createRandom().address;
    const vaultId = hre.ethers.id("test-changelawyer-" + Date.now());

    console.log("Creating vault...");
    let tx = await vault.createVault(
        owner,
        vaultId,
        [beneficiary],
        lawyer1,
        2,
        60,
        "ipfs//test1",
        "ipfs//test2"
    );
    await tx.wait();
    console.log("Vault created successfully.");

    console.log("Changing lawyer...");
    try {
        tx = await vault.changeLawyer(vaultId, lawyer2);
        await tx.wait();
        console.log("Lawyer changed successfully!");
    } catch (e) {
        console.error("Change Lawyer Failed!");
        console.error("Reason:", e.reason);
        if (e.info) console.error("Info:", e.info);
    }
}
main().catch(console.error);
