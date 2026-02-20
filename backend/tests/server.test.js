const request = require("supertest");

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

    it("should collect shares successfully", async () => {
        const response = await request(app)
            .post("/api/vault/collect-shares")
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
        const response = await request(app)
            .post("/api/avalanche/change-lawyer")
            .send({
                testatorMnemonic: "test mnemonic",
                vaultId: "0x123",
                newLawyerAddress: "0xlawyer"
            });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });
});
