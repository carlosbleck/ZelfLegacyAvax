const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("VaultRegistry UUPS Upgrade", function () {
    it("Should deploy and upgrade VaultRegistry", async function () {
        const [owner] = await ethers.getSigners();
        const VaultRegistry = await ethers.getContractFactory("VaultRegistry");

        // 1. Deploy Proxy
        const proxy = await upgrades.deployProxy(VaultRegistry, [owner.address], {
            kind: 'uups',
            initializer: 'initialize'
        });
        await proxy.waitForDeployment();
        const proxyAddress = await proxy.getAddress();

        // 2. Test initial state
        expect(await proxy.owner()).to.equal(owner.address);
        expect(await proxy.relayer()).to.equal(owner.address);

        // 3. Create a vault (mock data)
        const vaultId = ethers.id("test-vault");
        const beneficiaries = [ethers.Wallet.createRandom().address];
        const lawyer = ethers.Wallet.createRandom().address;

        await proxy.createVault(
            owner.address,
            vaultId,
            beneficiaries,
            lawyer,
            1, // threshold
            3600, // heartbeat
            "ipfs://mock-cid",
            "ipfs://mock-validator"
        );

        const vault = await proxy.getVault(vaultId);
        expect(vault.owner).to.equal(owner.address);

        // 4. Upgrade to same contract (just to test authority)
        const VaultRegistryV2 = await ethers.getContractFactory("VaultRegistry");
        const upgraded = await upgrades.upgradeProxy(proxyAddress, VaultRegistryV2);

        expect(await upgraded.getAddress()).to.equal(proxyAddress);

        // 5. Verify state is preserved
        const vaultAfter = await upgraded.getVault(vaultId);
        expect(vaultAfter.owner).to.equal(owner.address);
    });
});
