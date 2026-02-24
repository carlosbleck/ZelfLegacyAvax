// Must set before server is loaded (middleware reads it at require time)
process.env.LEGACY_CLIENT_SECRET = "test_client_secret";

const request = require("supertest");
const { ethers } = require("ethers");

/**
 * Build a valid authSig for testing. Signs the given message with a random wallet.
 */
async function buildAuthSig(message) {
    const wallet = ethers.Wallet.createRandom();
    const sig = await wallet.signMessage(message);
    return {
        sig,
        signedMessage: message,
        address: wallet.address,
        derivedVia: "web3.eth.personal.sign"
    };
}

/** Default header required for all /api/ routes */
const clientHeader = { "X-Zelf-Client-Secret": "test_client_secret" };

// Mock Lit Protocol ESM dependencies to prevent Jest syntax errors
jest.mock("@lit-protocol/lit-client", () => ({}));
jest.mock("@lit-protocol/networks", () => ({}));
jest.mock("@lit-protocol/constants", () => ({}));
jest.mock("@lit-protocol/auth-helpers", () => ({}));
jest.mock("siwe", () => ({}));
jest.mock("@noble/curves/ed25519", () => ({}));

const app = require("../server");

// Mock dependencies to prevent real network calls
jest.mock("../lit-manager", () => {
    return jest.fn().mockImplementation(() => ({
        encryptPasswordShare: jest.fn().mockResolvedValue({ ciphertext: "cypher", dataToEncryptHash: "hash" }),
        decryptPasswordShare: jest.fn().mockResolvedValue("decrypted"),
        connect: jest.fn(),
        disconnect: jest.fn()
    }));
});

jest.mock("../ipfs-manager", () => {
    return jest.fn().mockImplementation(() => ({
        uploadEncryptedShare: jest.fn().mockResolvedValue("mock_cid"),
        retrieve: jest.fn().mockResolvedValue({ ciphertext: "cypher", dataToEncryptHash: "hash" })
    }));
});

jest.mock("../avalanche-manager", () => {
    return jest.fn().mockImplementation(() => ({
        changeLawyer: jest.fn().mockResolvedValue({ blockNumber: 1, transactionHash: "0xMockHash" }),
        createVault: jest.fn().mockResolvedValue({ transactionHash: "0xCreateVaultHash", blockNumber: 2 }),
        contract: {
            isBeneficiary: jest.fn().mockResolvedValue(true)
        }
    }));
});

describe("Server API Enhancements", () => {
    beforeAll(() => {
        jest.spyOn(console, 'log').mockImplementation(() => { });
        jest.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    // ===== HEALTH =====
    it("should hit health check endpoint", async () => {
        const response = await request(app).get("/health");
        expect(response.status).toBe(200);
        expect(response.body.status).toBe("ok");
    });

    // ===== AUTH MIDDLEWARE =====
    it("should reject /api/ requests without X-Zelf-Client-Secret header", async () => {
        const response = await request(app)
            .post("/api/vault/collect-shares")
            .send({
                vaultId: "0x123",
                beneficiaryAddress: "0xabc",
                share: "mock_share_data"
            });

        expect(response.status).toBe(401);
        expect(response.body.error).toContain("client key");
    });

    // ===== COLLECT SHARES =====
    it("should collect shares successfully", async () => {
        const response = await request(app)
            .post("/api/vault/collect-shares")
            .set(clientHeader)
            .send({
                vaultId: "0x123",
                beneficiaryAddress: "0xabc",
                share: "mock_share_data"
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.totalCollected).toBeGreaterThan(0);
    });

    // ===== ENCRYPT SHARES (SINGLE BENEFICIARY) =====
    it("should encrypt shares for a single beneficiary", async () => {
        const response = await request(app)
            .post("/api/vault/encrypt-shares")
            .set(clientHeader)
            .send({
                shares: [
                    {
                        address: "0xBeneficiary1",
                        passwordparty: "share_party_1",
                        passwordlawyer: "share_lawyer_1"
                    }
                ],
                vaultId: "0xVaultId123",
                contractAddress: "0xContractAddr"
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.manifestCID).toBe("mock_cid");
    });

    // ===== ENCRYPT SHARES (MULTI BENEFICIARY) =====
    it("should encrypt shares for multiple beneficiaries", async () => {
        const response = await request(app)
            .post("/api/vault/encrypt-shares")
            .set(clientHeader)
            .send({
                shares: [
                    {
                        address: "0xBeneficiary1",
                        passwordparty: "share_party_1",
                        passwordlawyer: "share_lawyer_1"
                    },
                    {
                        address: "0xBeneficiary2",
                        passwordparty: "share_party_2",
                        passwordlawyer: "share_lawyer_2"
                    },
                    {
                        address: "0xBeneficiary3",
                        passwordparty: "share_party_3",
                        passwordlawyer: "share_lawyer_3"
                    }
                ],
                vaultId: "0xVaultIdMulti",
                contractAddress: "0xContractAddr"
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.manifestCID).toBeTruthy();
    });

    // ===== ENCRYPT SHARES (VALIDATION) =====
    it("should reject encrypt-shares with missing/invalid body", async () => {
        // Missing shares array
        const r1 = await request(app)
            .post("/api/vault/encrypt-shares")
            .set(clientHeader)
            .send({ vaultId: "0x123", contractAddress: "0xabc" });
        expect(r1.status).toBe(400);

        // Non-array shares
        const r2 = await request(app)
            .post("/api/vault/encrypt-shares")
            .set(clientHeader)
            .send({ shares: "not-an-array", vaultId: "0x123", contractAddress: "0xabc" });
        expect(r2.status).toBe(400);

        // Missing vaultId
        const r3 = await request(app)
            .post("/api/vault/encrypt-shares")
            .set(clientHeader)
            .send({ shares: [{ address: "0xA", passwordparty: "p", passwordlawyer: "l" }], contractAddress: "0xabc" });
        expect(r3.status).toBe(400);
    });

    // ===== CREATE VAULT =====
    it("should create a vault with multiple beneficiaries and threshold", async () => {
        const vaultId = "0xVault999";
        const beneficiaryAddresses = ["0xBen1", "0xBen2", "0xBen3"];
        const threshold = 2;
        const nonce = Date.now();
        const message = `ZelfLegacy create-vault ${vaultId} ${beneficiaryAddresses[0]} ${nonce}`;
        const authSig = await buildAuthSig(message);

        const response = await request(app)
            .post("/api/avalanche/create-vault")
            .set(clientHeader)
            .send({
                authSig,
                beneficiaryAddresses,
                threshold,
                lawyerAddress: "0xLawyer1",
                heartbeatInterval: 2592000,
                ipfsCid: "Qm_legacywill_CID",
                ipfsCidValidator: "Qm_manifest_CID",
                vaultId
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.transactionHash).toBeTruthy();
    });

    it("should create a vault with a single beneficiary (backward-compat)", async () => {
        const vaultId = "0xVaultSingle";
        const beneficiaryAddresses = ["0xSingleBen"];
        const threshold = 1;
        const nonce = Date.now();
        const message = `ZelfLegacy create-vault ${vaultId} ${beneficiaryAddresses[0]} ${nonce}`;
        const authSig = await buildAuthSig(message);

        const response = await request(app)
            .post("/api/avalanche/create-vault")
            .set(clientHeader)
            .send({
                authSig,
                beneficiaryAddresses,
                threshold,
                lawyerAddress: null,
                heartbeatInterval: 2592000,
                ipfsCid: "Qm_legacywill_CID",
                ipfsCidValidator: "Qm_manifest_CID",
                vaultId
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    it("should reject create-vault with missing required fields", async () => {
        const response = await request(app)
            .post("/api/avalanche/create-vault")
            .set(clientHeader)
            .send({
                // Missing authSig, threshold, vaultId etc.
                beneficiaryAddresses: ["0xBen1"],
                ipfsCid: "Qm123",
                ipfsCidValidator: "Qm456"
            });

        expect(response.status).toBe(400);
    });

    it("should reject create-vault with invalid authSig", async () => {
        const response = await request(app)
            .post("/api/avalanche/create-vault")
            .set(clientHeader)
            .send({
                authSig: { sig: "0xbad", signedMessage: "wrong", address: "0x123" },
                beneficiaryAddresses: ["0xBen1"],
                threshold: 1,
                vaultId: "0xV1",
                ipfsCid: "Qm1",
                ipfsCidValidator: "Qm2"
            });

        expect(response.status).toBe(401);
    });

    // ===== CHANGE LAWYER =====
    it("should change lawyer successfully", async () => {
        const vaultId = "0x123";
        const newLawyerAddress = "0xlawyer";
        const nonce = Date.now();
        const message = `ZelfLegacy change-lawyer ${vaultId} ${newLawyerAddress} ${nonce}`;
        const authSig = await buildAuthSig(message);

        const response = await request(app)
            .post("/api/avalanche/change-lawyer")
            .set(clientHeader)
            .send({
                authSig,
                vaultId,
                newLawyerAddress
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    it("should reject change-lawyer with invalid authSig", async () => {
        const response = await request(app)
            .post("/api/avalanche/change-lawyer")
            .set(clientHeader)
            .send({
                authSig: { sig: "0xbad", signedMessage: "wrong", address: "0x123" },
                vaultId: "0x123",
                newLawyerAddress: "0xlawyer"
            });

        expect(response.status).toBe(401);
    });
});
