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
        changeLawyer: jest.fn().mockResolvedValue({ blockNumber: 1, transactionHash: "0xMockHash" })
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

    it("should hit health check endpoint", async () => {
        const response = await request(app).get("/health");
        expect(response.status).toBe(200);
        expect(response.body.status).toBe("ok");
    });

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
