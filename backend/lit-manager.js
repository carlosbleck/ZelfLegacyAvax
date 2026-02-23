/**
 * Lit Protocol Manager for ZelfLegacy Inheritance
 * SDK v8 (Naga network) - Handles encryption/decryption of password shares
 *
 * Migration from v7 (Datil) to v8 (Naga):
 *  - @lit-protocol/lit-node-client  -> @lit-protocol/lit-client
 *  - new LitNodeClient(...)         -> createLitClient({ network })
 *  - LIT_NETWORK.DatilDev           -> nagaDev (from @lit-protocol/networks)
 *  - encryptString() standalone     -> litClient.encrypt(...)
 *  - sessionSigs                    -> authContext
 */

const { createLitClient } = require('@lit-protocol/lit-client');
const { nagaDev, nagaTest, naga } = require('@lit-protocol/networks');
const { LIT_ABILITY } = require('@lit-protocol/constants');
const { LitAccessControlConditionResource, RecapSessionCapabilityObject } = require('@lit-protocol/auth-helpers');
const { SiweMessage } = require('siwe');
const { ethers } = require('ethers');

// Map env string to network object
const NETWORK_MAP = {
    nagaDev,
    naga_dev: nagaDev,
    NagaDev: nagaDev,
    nagaTest,
    naga_test: nagaTest,
    NagaTest: nagaTest,
    naga,
    Naga: naga,
};

class LitManager {
    constructor(privateKey) {
        this.litClient = null;
        this.chain = 'fuji'; // Avalanche Fuji testnet
        this.privateKey = privateKey;
        this.relayerAddress = new ethers.Wallet(privateKey).address.toLowerCase();
    }

    /**
     * Initialize Lit Protocol v8 client
     */
    async connect() {
        if (this.litClient) {
            return;
        }

        const networkKey = 'nagaDev'; // Force to central dev network which avoids requirement of capacity credits
        const network = NETWORK_MAP[networkKey];

        console.log(`🔗 Connecting to Lit Protocol network: ${networkKey}`);

        this.litClient = await createLitClient({ network });
        console.log('✅ Connected to Lit Protocol (v8 / Naga)');
    }

    /**
     * Encrypt a password share with Lit Protocol access control.
     * Access is gated by VaultRegistry.isClaimable(vaultId) == true on Avalanche.
     *
     * @param {string} passwordShare - The Shamir password share to encrypt
     * @param {string} vaultId - The vault ID (bytes32 hex string)
     * @param {string} contractAddress - VaultRegistry contract address
     * @returns {Promise<{ciphertext: string, dataToEncryptHash: string}>}
     */
    async encryptPasswordShare(passwordShare, vaultId, contractAddress) {
        await this.connect();

        // EVM contract conditions: only claimable vaults can decrypt
        // Note: evmContractConditions accepts only evmContract conditions (not evmBasic).
        // The relayer address restriction is enforced at the API layer (server verifies beneficiary before decrypting).
        const evmContractConditions = [
            {
                contractAddress: contractAddress,
                functionName: 'isClaimable',
                functionParams: [vaultId],
                functionAbi: {
                    name: 'isClaimable',
                    inputs: [{ name: 'vaultId', type: 'bytes32' }],
                    outputs: [{ name: '', type: 'bool' }],
                    stateMutability: 'view',
                    type: 'function',
                },
                chain: this.chain,
                returnValueTest: {
                    key: '',
                    comparator: '=',
                    value: 'true',
                },
            },
        ];

        const encrypted = await this.litClient.encrypt({
            dataToEncrypt: passwordShare,
            evmContractConditions,
            chain: this.chain,
        });

        return {
            ciphertext: encrypted.ciphertext,
            dataToEncryptHash: encrypted.dataToEncryptHash,
        };
    }

    /**
     * Decrypt a password share (only works if isClaimable == true).
     *
     * @param {string} ciphertext - The encrypted data
     * @param {string} dataToEncryptHash - Hash of the original data
     * @param {string} vaultId - The vault ID
     * @param {string} contractAddress - VaultRegistry contract address
     * @returns {Promise<string>} - Decrypted password share
     */
    async decryptPasswordShare(ciphertext, dataToEncryptHash, vaultId, contractAddress) {
        await this.connect();

        const evmContractConditions = [
            {
                contractAddress: contractAddress,
                functionName: 'isClaimable',
                functionParams: [vaultId],
                functionAbi: {
                    name: 'isClaimable',
                    inputs: [{ name: 'vaultId', type: 'bytes32' }],
                    outputs: [{ name: '', type: 'bool' }],
                    stateMutability: 'view',
                    type: 'function',
                },
                chain: this.chain,
                returnValueTest: {
                    key: '',
                    comparator: '=',
                    value: 'true',
                },
            },
        ];

        // Generate a fresh Ed25519 session keypair for this request
        const { ed25519 } = require('@noble/curves/ed25519');
        const secretKeyBytes = ed25519.utils.randomPrivateKey();
        const publicKeyBytes = ed25519.getPublicKey(secretKeyBytes);
        const secretKey = Buffer.from(secretKeyBytes).toString('hex');
        const publicKey = Buffer.from(publicKeyBytes).toString('hex');

        const expiration = new Date(Date.now() + 1000 * 60 * 60).toISOString(); // 1 hour

        // The relayer's EOA wallet signs the session via authNeededCallback
        const relayerWallet = new ethers.Wallet(this.privateKey);

        const authContext = {
            sessionKeyPair: { publicKey, secretKey },
            authNeededCallback: async () => {
                // Build a proper SIWE message with Expiration Time + ReCap capabilities
                const accResource = new LitAccessControlConditionResource('*');

                // Create recap object and add decryption capability
                const recapObject = new RecapSessionCapabilityObject();
                recapObject.addCapabilityForResource(accResource, LIT_ABILITY.AccessControlConditionDecryption);

                let siweMessage = new SiweMessage({
                    domain: 'localhost',
                    address: relayerWallet.address,
                    statement: `Lit Protocol Decryption for vault ${vaultId}`,
                    uri: `lit:session:${publicKey}`,
                    version: '1',
                    chainId: 1,
                    nonce: publicKey.slice(0, 8),
                    expirationTime: expiration,
                    issuedAt: new Date().toISOString(),
                });

                // Embed the recap capabilities into the SIWE message
                siweMessage = recapObject.addToSiweMessage(siweMessage);

                const messageToSign = siweMessage.prepareMessage();
                const signature = await relayerWallet.signMessage(messageToSign);
                return {
                    sig: signature,
                    derivedVia: 'web3.eth.personal.sign',
                    signedMessage: messageToSign,
                    address: relayerWallet.address,
                };
            },
            authConfig: {
                expiration,
                resources: [
                    {
                        resource: new LitAccessControlConditionResource('*'),
                        ability: LIT_ABILITY.AccessControlConditionDecryption,
                    },
                ],
            },
        };

        const decrypted = await this.litClient.decrypt({
            data: { ciphertext, dataToEncryptHash },
            evmContractConditions,
            authContext,
            chain: this.chain,
        });

        return Buffer.from(decrypted.decryptedData).toString('utf-8');
    }

    /**
     * Disconnect from Lit Protocol
     */
    async disconnect() {
        if (this.litClient) {
            await this.litClient.disconnect();
            this.litClient = null;
            console.log('✅ Disconnected from Lit Protocol');
        }
    }
}

module.exports = LitManager;
