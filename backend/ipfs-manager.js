/**
 * IPFS Manager for ZelfLegacy Inheritance
 * Handles uploading files to IPFS via Pinata
 */

const axios = require('axios');
const FormData = require('form-data');

class IPFSManager {
    constructor(pinataApiKey, pinataSecretKey) {
        this.pinataApiKey = pinataApiKey;
        this.pinataSecretKey = pinataSecretKey;
        this.pinataEndpoint = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';
    }

    /**
     * Upload JSON data to IPFS via Pinata
     * @param {object} jsonData - The JSON data to upload
     * @param {string} name - Name for the pinned file
     * @returns {Promise<string>} - IPFS CID
     */
    async uploadJSON(jsonData, name) {
        try {
            const response = await axios.post(
                this.pinataEndpoint,
                {
                    pinataContent: jsonData,
                    pinataMetadata: {
                        name: name,
                    },
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        pinata_api_key: this.pinataApiKey,
                        pinata_secret_api_key: this.pinataSecretKey,
                    },
                }
            );

            console.log(`✅ Uploaded to IPFS: ${name} -> ${response.data.IpfsHash}`);
            return response.data.IpfsHash;
        } catch (error) {
            console.error('❌ IPFS upload failed:', error.response?.data || error.message);
            throw new Error('Failed to upload to IPFS');
        }
    }

    /**
     * Upload password shares manifest to IPFS
     * @param {string} passwordpartyCID - CID of passwordparty file
     * @param {string} passwordlawyerCID - CID of passwordlawyer file
     * @param {string} vaultId - Vault ID for naming
     * @returns {Promise<string>} - Manifest CID
     */
    async uploadPasswordSharesManifest(passwordpartyCID, passwordlawyerCID, vaultId) {
        const manifest = {
            passwordparty: `ipfs://${passwordpartyCID}`,
            passwordlawyer: `ipfs://${passwordlawyerCID}`,
            version: '1.0',
            type: 'single-ben',
            vaultId: vaultId,
        };

        return await this.uploadJSON(manifest, `vault-${vaultId}-manifest`);
    }

    /**
     * Upload encrypted password share to IPFS
     * @param {object} encryptedShare - Encrypted share data from Lit Protocol
     * @param {string} shareName - Name of the share (passwordparty or passwordlawyer)
     * @param {string} vaultId - Vault ID for naming
     * @returns {Promise<string>} - IPFS CID
     */
    async uploadEncryptedShare(encryptedShare, shareName, vaultId) {
        const shareData = {
            ciphertext: encryptedShare.ciphertext,
            dataToEncryptHash: encryptedShare.dataToEncryptHash,
            shareName: shareName,
            vaultId: vaultId,
            timestamp: new Date().toISOString(),
        };

        return await this.uploadJSON(shareData, `vault-${vaultId}-${shareName}`);
    }

    /**
     * Retrieve data from IPFS
     * @param {string} cid - IPFS CID
     * @returns {Promise<object>} - Retrieved data
     */
    async retrieve(cid) {
        try {
            const response = await axios.get(`https://gateway.pinata.cloud/ipfs/${cid}`);
            return response.data;
        } catch (error) {
            console.error('❌ IPFS retrieval failed:', error.message);
            throw new Error('Failed to retrieve from IPFS');
        }
    }
}

module.exports = IPFSManager;
