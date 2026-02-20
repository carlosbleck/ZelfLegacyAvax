const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("VaultRegistry Enhancements", function () {
    let vaultRegistry;
    let owner;
    let lawyer1;
    let lawyer2;
    let beneficiary;
    let vaultId;

    beforeEach(async function () {
        [owner, lawyer1, lawyer2, beneficiary] = await ethers.getSigners();
        const VaultRegistry = await ethers.getContractFactory("VaultRegistry");

        vaultRegistry = await upgrades.deployProxy(VaultRegistry, [owner.address], {
            kind: 'uups',
            initializer: 'initialize'
        });
        await vaultRegistry.waitForDeployment();

        vaultId = ethers.id("test-vault");
        await vaultRegistry.createVault(
            owner.address,
            vaultId,
            [beneficiary.address],
            lawyer1.address,
            1, // threshold
            3600, // heartbeat (1 hour)
            "ipfs://mock-cid",
            "ipfs://mock-validator"
        );
    });

    it("should allow owner to change lawyer in PendingLawyer state", async function () {
        await expect(vaultRegistry.changeLawyer(vaultId, lawyer2.address))
            .to.emit(vaultRegistry, "LawyerChanged")
            .withArgs(vaultId, lawyer1.address, lawyer2.address);

        const vault = await vaultRegistry.getVault(vaultId);
        expect(vault.lawyer).to.equal(lawyer2.address);

        // Check mappings
        const lawyer1Vaults = await vaultRegistry.getLawyerVaults(lawyer1.address);
        expect(lawyer1Vaults).to.not.include(vaultId);

        const lawyer2Vaults = await vaultRegistry.getLawyerVaults(lawyer2.address);
        expect(lawyer2Vaults).to.include(vaultId);
    });

    it("should not allow changing lawyer if not owner or relayer", async function () {
        await expect(
            vaultRegistry.connect(beneficiary).changeLawyer(vaultId, lawyer2.address)
        ).to.be.revertedWith("Not authorized to change lawyer");
    });

    it("should not allow changing lawyer if vault is not in PendingLawyer state", async function () {
        await vaultRegistry.connect(lawyer1).acceptVault(vaultId);
        await expect(
            vaultRegistry.changeLawyer(vaultId, lawyer2.address)
        ).to.be.revertedWith("Vault not in pending state");
    });

    it("isClaimable should be false initially in PendingLawyer state", async function () {
        expect(await vaultRegistry.isClaimable(vaultId)).to.be.false;
    });

    it("isClaimable should be true in PendingLawyer state after timeout", async function () {
        // Increase time by heartbeatInterval (3600) + 1 second
        await time.increase(3601);
        expect(await vaultRegistry.isClaimable(vaultId)).to.be.true;
    });

    it("isClaimable should reset timeout when lawyer is changed", async function () {
        // Increase time by half the timeout
        await time.increase(1800);
        expect(await vaultRegistry.isClaimable(vaultId)).to.be.false;

        // Change lawyer
        await vaultRegistry.changeLawyer(vaultId, lawyer2.address);

        // Increase time by another half. Original timeout would have been reached, but since it's reset, it should be false.
        await time.increase(1801);
        expect(await vaultRegistry.isClaimable(vaultId)).to.be.false;

        // Increase time to reach the new timeout
        await time.increase(1800);
        expect(await vaultRegistry.isClaimable(vaultId)).to.be.true;
    });
});
