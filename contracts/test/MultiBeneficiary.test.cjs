const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("VaultRegistry – Multi-Beneficiary Execution", function () {
    let vaultRegistry;
    let owner, relayer, lawyer;
    let ben1, ben2, ben3;

    const heartbeat = 3600; // 1 hour
    const ipfsCid = "ipfs://mock-cid";
    const ipfsValidator = "ipfs://mock-validator";

    async function makeVaultId(label) {
        return ethers.id(label);
    }

    beforeEach(async function () {
        [owner, relayer, lawyer, ben1, ben2, ben3] = await ethers.getSigners();

        const VaultRegistry = await ethers.getContractFactory("VaultRegistry");
        vaultRegistry = await upgrades.deployProxy(VaultRegistry, [owner.address], {
            kind: "uups",
            initializer: "initialize",
        });
        await vaultRegistry.waitForDeployment();

        // Set relayer to the dedicated relayer signer
        await vaultRegistry.connect(owner).setRelayer(relayer.address);
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Helper: create a claimable vault with the given beneficiaries and threshold
    // ─────────────────────────────────────────────────────────────────────────────
    async function deployClaimableVault(label, beneficiaries, threshold) {
        const vaultId = await makeVaultId(label);
        await vaultRegistry.connect(relayer).createVault(
            owner.address,
            vaultId,
            beneficiaries.map((b) => b.address),
            lawyer.address,
            threshold,
            heartbeat,
            ipfsCid,
            ipfsValidator
        );
        // Lawyer confirms death → Claimable
        await vaultRegistry.connect(lawyer).acceptVault(vaultId);
        await vaultRegistry.connect(lawyer).confirmDeath(vaultId);
        return vaultId;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Single beneficiary – backward compat
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Single beneficiary (threshold = 1)", function () {
        it("should transition to Executed on first and only acceptance", async function () {
            const vaultId = await deployClaimableVault("single", [ben1], 1);

            await expect(
                vaultRegistry.connect(relayer).executeVault(vaultId, ben1.address)
            )
                .to.emit(vaultRegistry, "VaultExecuted")
                .withArgs(vaultId, ben1.address, 1n, 1n);

            const vault = await vaultRegistry.getVault(vaultId);
            expect(vault.state).to.equal(4); // Executed
        });

        it("should report executedCount = 1, threshold = 1 after execution", async function () {
            const vaultId = await deployClaimableVault("single-status", [ben1], 1);
            await vaultRegistry.connect(relayer).executeVault(vaultId, ben1.address);

            const [count, thresh] = await vaultRegistry.getExecutionStatus(vaultId);
            expect(count).to.equal(1n);
            expect(thresh).to.equal(1n);
        });

        it("should block a double-acceptance from the same beneficiary (vault already Executed)", async function () {
            const vaultId = await deployClaimableVault("single-double", [ben1], 1);
            await vaultRegistry.connect(relayer).executeVault(vaultId, ben1.address);

            // After threshold=1 is met the vault is Executed — the state guard fires first
            await expect(
                vaultRegistry.connect(relayer).executeVault(vaultId, ben1.address)
            ).to.be.revertedWith("Invalid state for execution");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Multi-beneficiary – 2-of-3 threshold
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Multi-beneficiary (threshold = 2, 3 beneficiaries)", function () {
        let vaultId;

        beforeEach(async function () {
            vaultId = await deployClaimableVault("multi-2of3", [ben1, ben2, ben3], 2);
        });

        it("should NOT mark vault as Executed after first acceptance", async function () {
            await vaultRegistry.connect(relayer).executeVault(vaultId, ben1.address);

            const vault = await vaultRegistry.getVault(vaultId);
            // Still Claimable (state 3)
            expect(vault.state).to.equal(3);

            const [count, thresh] = await vaultRegistry.getExecutionStatus(vaultId);
            expect(count).to.equal(1n);
            expect(thresh).to.equal(2n);
        });

        it("should mark vault as Executed once threshold (2) is reached", async function () {
            await vaultRegistry.connect(relayer).executeVault(vaultId, ben1.address);
            await expect(
                vaultRegistry.connect(relayer).executeVault(vaultId, ben2.address)
            )
                .to.emit(vaultRegistry, "VaultExecuted")
                .withArgs(vaultId, ben2.address, 2n, 2n);

            const vault = await vaultRegistry.getVault(vaultId);
            expect(vault.state).to.equal(4); // Executed
        });

        it("should block a non-beneficiary from accepting", async function () {
            await expect(
                vaultRegistry.connect(relayer).executeVault(vaultId, owner.address)
            ).to.be.revertedWith("Only a beneficiary can execute");
        });

        it("should block double-acceptance from the same beneficiary", async function () {
            await vaultRegistry.connect(relayer).executeVault(vaultId, ben1.address);
            await expect(
                vaultRegistry.connect(relayer).executeVault(vaultId, ben1.address)
            ).to.be.revertedWith("Beneficiary has already accepted this vault");
        });

        it("should allow beneficiary to call directly (without relayer)", async function () {
            // ben1 calls directly as themselves
            await vaultRegistry.connect(ben1).executeVault(vaultId, ben1.address);
            const [count] = await vaultRegistry.getExecutionStatus(vaultId);
            expect(count).to.equal(1n);
        });

        it("third beneficiary acceptance on already-Executed vault should revert", async function () {
            await vaultRegistry.connect(relayer).executeVault(vaultId, ben1.address);
            await vaultRegistry.connect(relayer).executeVault(vaultId, ben2.address);
            // Vault is now Executed — state != Claimable/Active/Warning
            await expect(
                vaultRegistry.connect(relayer).executeVault(vaultId, ben3.address)
            ).to.be.revertedWith("Invalid state for execution");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. getExecutionStatus on a non-existent vault
    // ─────────────────────────────────────────────────────────────────────────────
    it("getExecutionStatus should revert for unknown vault", async function () {
        const fakeVaultId = ethers.id("ghost");
        await expect(
            vaultRegistry.getExecutionStatus(fakeVaultId)
        ).to.be.revertedWith("Vault does not exist");
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Edge Cases: Vault Creation and Constraints
    // ─────────────────────────────────────────────────────────────────────────────
    describe("Creation and Timing Constraints", function () {
        it("should revert creation if threshold is 0", async function () {
            const vaultId = await makeVaultId("threshold-0");
            await expect(
                vaultRegistry.connect(relayer).createVault(
                    owner.address, vaultId, [ben1.address], lawyer.address, 0, heartbeat, ipfsCid, ipfsValidator
                )
            ).to.be.revertedWith("Invalid threshold");
        });

        it("should revert creation if threshold > beneficiaries.length + 1", async function () {
            const vaultId = await makeVaultId("threshold-too-high");
            await expect(
                vaultRegistry.connect(relayer).createVault(
                    owner.address, vaultId, [ben1.address, ben2.address], lawyer.address, 4, heartbeat, ipfsCid, ipfsValidator
                )
            ).to.be.revertedWith("Invalid threshold");
        });

        it("should revert executeVault if vault is not claimable", async function () {
            const vaultId = await makeVaultId("not-claimable-yet");
            // Create vault, but do NOT acceptVault or confirmDeath or pass time
            await vaultRegistry.connect(relayer).createVault(
                owner.address, vaultId, [ben1.address], lawyer.address, 1, heartbeat, ipfsCid, ipfsValidator
            );

            await expect(
                vaultRegistry.connect(relayer).executeVault(vaultId, ben1.address)
            ).to.be.revertedWith("Vault is not claimable yet");
        });
    });
});
