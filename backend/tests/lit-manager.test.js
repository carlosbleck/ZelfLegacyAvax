// Mock Lit Protocol ESM dependencies to prevent Jest syntax errors
jest.mock("@lit-protocol/networks", () => ({
    nagaDev: 'nagaDev',
    nagaTest: 'nagaTest',
    naga: 'naga'
}));
jest.mock("@lit-protocol/constants", () => ({}));
jest.mock("@lit-protocol/auth-helpers", () => ({}));
jest.mock("siwe", () => ({}));
jest.mock("@noble/curves/ed25519", () => ({}));

const LitManager = require("../lit-manager");

// Mock the lit-client and networks
jest.mock("@lit-protocol/lit-client", () => ({
    createLitClient: jest.fn().mockResolvedValue({
        connect: jest.fn(),
        encrypt: jest.fn().mockResolvedValue({
            ciphertext: "mock_ciphertext",
            dataToEncryptHash: "mock_hash"
        }),
        decrypt: jest.fn().mockResolvedValue("mock_decrypted_share"),
        disconnect: jest.fn()
    })
}));

describe("LitManager Enhancements", () => {
    let litManager;

    beforeEach(() => {
        litManager = new LitManager("0000000000000000000000000000000000000000000000000000000000000000"); // Mock PK
        // Prevent console logs during tests
        jest.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should connect to Fuji test network (nagaTest)", async () => {
        process.env.LIT_NETWORK = "nagaTest";
        await litManager.connect();
        expect(litManager.litClient).toBeDefined();
    });

    it("should encrypt a password share", async () => {
        const result = await litManager.encryptPasswordShare("secret_share", "0xVaultID", "0xContract");
        expect(result.ciphertext).toBe("mock_ciphertext");
        expect(result.dataToEncryptHash).toBe("mock_hash");
    });
});
