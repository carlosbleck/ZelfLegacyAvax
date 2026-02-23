/**
 * Avalanche Manager for ZelfLegacy
 * Handles interactions with VaultRegistry smart contract on Avalanche C-Chain
 */

const { ethers } = require('ethers');

class AvalancheManager {
    constructor(rpcUrl, contractAddress, privateKey) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.contractAddress = contractAddress;

        // VaultRegistry ABI from compiled Hardhat artifacts to avoid ethers parsing bugs
        const VaultRegistryArtifact = require('../contracts/artifacts/contracts/VaultRegistry.sol/VaultRegistry.json');
        this.contractABI = VaultRegistryArtifact.abi;

        // Initialize relayer wallet if private key provided
        if (privateKey) {
            this.relayerWallet = new ethers.Wallet(privateKey, this.provider);
            console.log(`🔑 Relayer wallet initialized: ${this.relayerWallet.address}`);
        }

        this.contract = new ethers.Contract(this.contractAddress, this.contractABI, this.provider);

        // If relayer wallet exists, connect the contract to it for sending transactions
        if (this.relayerWallet) {
            this.contract = this.contract.connect(this.relayerWallet);
        }
    }

    /**
     * Get address from mnemonic
     */
    getAddressFromMnemonic(mnemonic) {
        const wallet = ethers.Wallet.fromPhrase(mnemonic);
        return wallet.address;
    }

    /**
     * Create a new vault (Relayed: Relayer pays gas, testator remains owner)
     * @param {string} testatorAddress - Verified testator address (recovered from authSig by caller)
     */
    async createVault(
        testatorAddress,
        vaultId,
        beneficiaries,
        lawyer,
        heartbeatInterval,
        ipfsCid,
        ipfsCidValidator
    ) {
        try {
            console.log(`🏔️ Creating vault ${vaultId} for testator ${testatorAddress} (Relayed)`);

            // Use the relayer to send the transaction
            const tx = await this.contract.createVault(
                testatorAddress,
                vaultId,
                beneficiaries,
                lawyer,
                2, // Default threshold: at least 2 people needed (k-of-n)
                heartbeatInterval,
                ipfsCid,
                ipfsCidValidator
            );

            console.log(`Transaction sent by relayer ${this.relayerWallet.address}: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`✅ Vault created in block ${receipt.blockNumber}`);

            return {
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                vaultId: vaultId,
                owner: testatorAddress,
                relayer: this.relayerWallet.address
            };
        } catch (error) {
            console.error('❌ Error in createVault (Avax):', error);
            throw error;
        }
    }

    /**
     * Update heartbeat (Relayed)
     * @param {string} testatorAddress - Verified testator address (recovered from authSig by caller)
     */
    async updateHeartbeat(testatorAddress, vaultId) {
        try {
            console.log(`💓 Updating heartbeat for vault ${vaultId} on behalf of ${testatorAddress}`);

            const tx = await this.contract.updateHeartbeat(vaultId);
            const receipt = await tx.wait();

            return {
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                vaultId: vaultId
            };
        } catch (error) {
            console.error('❌ Error in updateHeartbeat:', error);
            throw error;
        }
    }

    /**
     * Cancel vault (Relayed)
     * @param {string} testatorAddress - Verified testator address (recovered from authSig by caller)
     */
    async cancelVault(testatorAddress, vaultId) {
        try {
            console.log(`🚫 Cancelling vault ${vaultId} on behalf of ${testatorAddress}`);

            const tx = await this.contract.cancelVault(vaultId);
            const receipt = await tx.wait();

            return {
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                vaultId: vaultId
            };
        } catch (error) {
            console.error('❌ Error in cancelVault:', error);
            throw error;
        }
    }

    /**
     * Change Lawyer (Relayed)
     * @param {string} testatorAddress - Verified testator address (recovered from authSig by caller)
     */
    async changeLawyer(testatorAddress, vaultId, newLawyer) {
        try {
            console.log(`⚖️ Changing lawyer for vault ${vaultId} to ${newLawyer} on behalf of ${testatorAddress}`);

            const tx = await this.contract.changeLawyer(vaultId, newLawyer);
            const receipt = await tx.wait();

            return {
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                vaultId: vaultId,
                newLawyer: newLawyer
            };
        } catch (error) {
            console.error('❌ Error in changeLawyer:', error);
            throw error;
        }
    }

    /**
     * Check if a vault is claimable
     */
    async isClaimable(vaultId) {
        return await this.contract.isClaimable(vaultId);
    }

    /**
     * Get vault details
     */
    async getVault(vaultId) {
        try {
            const vault = await this.contract.getVault(vaultId);
            // Map struct to JSON safely handling BigInts (converting to Number for Android compatibility)
            return {
                owner: vault.owner,
                beneficiaries: [...vault.beneficiaries],
                lawyer: vault.lawyer,
                heartbeatInterval: Number(vault.heartbeatInterval),
                lastPing: Number(vault.lastPing),
                createdAt: Number(vault.createdAt),
                activationDate: Number(vault.activationDate),
                ipfsCid: vault.ipfsCid,
                ipfsCidValidator: vault.ipfsCidValidator,
                state: Number(vault.state),
                threshold: Number(vault.threshold),
                exists: vault.exists
            };
        } catch (error) {
            console.error('❌ Error getting vault details:', error);
            throw error;
        }
    }

    /**
     * Get all vaults for a beneficiary
     */
    async getBeneficiaryVaults(beneficiaryAddress) {
        try {
            const vaultIds = await this.contract.getBeneficiaryVaults(beneficiaryAddress);
            // Return unique IDs (though contract should handle uniqueness, set makes sure)
            return [...new Set(vaultIds)];
        } catch (error) {
            console.error('❌ Error getting beneficiary vaults:', error);
            // Return empty array instead of throwing, as it might just be a connection issue or no vaults
            return [];
        }
    }

    /**
     * Get all vaults for an owner (testator)
     */
    async getUserVaults(ownerAddress) {
        try {
            const vaultIds = await this.contract.getUserVaults(ownerAddress);
            return [...new Set(vaultIds)];
        } catch (error) {
            console.error('❌ Error getting owner vaults:', error);
            return [];
        }
    }

    /**
     * Get full vault details for all vaults where the given address is a beneficiary
     */
    async getBeneficiaryVaultsData(beneficiaryAddress) {
        try {
            const vaultIds = await this.contract.getBeneficiaryVaults(beneficiaryAddress);
            const uniqueIds = [...new Set(vaultIds)];

            const vaults = [];
            for (const vaultId of uniqueIds) {
                try {
                    const vaultData = await this.getVault(vaultId);
                    vaults.push({ vaultId: vaultId.toString(), ...vaultData });
                } catch (e) {
                    console.warn(`⚠️ Could not fetch vault ${vaultId}:`, e.message);
                }
            }
            return vaults;
        } catch (error) {
            console.error('❌ Error getting beneficiary vault data:', error);
            return [];
        }
    }

    /**
     * Get all vaults for a lawyer
     */
    async getLawyerVaults(lawyerAddress) {
        try {
            const vaultIds = await this.contract.getLawyerVaults(lawyerAddress);
            return [...new Set(vaultIds)];
        } catch (error) {
            console.error('❌ Error getting lawyer vaults:', error);
            return [];
        }
    }



    /**
     * Accept a vault (Lawyer only)
     * @param {string} lawyerAddress - Verified lawyer address (recovered from authSig by caller)
     */
    async acceptVault(lawyerAddress, vaultId) {
        try {
            console.log(`⚖️ Accepting vault ${vaultId} as lawyer ${lawyerAddress}`);

            const vault = await this.contract.getVault(vaultId);
            if (vault.lawyer.toLowerCase() !== lawyerAddress.toLowerCase()) {
                throw new Error("Unauthorized: Mnemonic does not match vault lawyer");
            }

            const tx = await this.contract.acceptVault(vaultId);
            const receipt = await tx.wait();

            return {
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                vaultId: vaultId
            };
        } catch (error) {
            console.error('❌ Error accepting vault:', error);
            throw error;
        }
    }

    /**
     * Reject a vault (Lawyer only)
     * @param {string} lawyerAddress - Verified lawyer address (recovered from authSig by caller)
     */
    async rejectVault(lawyerAddress, vaultId) {
        try {
            console.log(`⚖️ Rejecting vault ${vaultId} as lawyer ${lawyerAddress}`);

            const vault = await this.contract.getVault(vaultId);
            if (vault.lawyer.toLowerCase() !== lawyerAddress.toLowerCase()) {
                throw new Error("Unauthorized: Mnemonic does not match vault lawyer");
            }

            const tx = await this.contract.rejectVault(vaultId);
            const receipt = await tx.wait();

            return {
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                vaultId: vaultId
            };
        } catch (error) {
            console.error('❌ Error rejecting vault:', error);
            throw error;
        }
    }

    /**
     * Confirm death (Lawyer only)
     * @param {string} lawyerAddress - Verified lawyer address (recovered from authSig by caller)
     */
    async confirmDeath(lawyerAddress, vaultId) {
        try {
            console.log(`⚰️ Confirming death for vault ${vaultId} as lawyer ${lawyerAddress}`);

            const vault = await this.contract.getVault(vaultId);
            if (vault.lawyer.toLowerCase() !== lawyerAddress.toLowerCase()) {
                throw new Error("Unauthorized: Mnemonic does not match vault lawyer");
            }

            const tx = await this.contract.confirmDeath(vaultId);
            const receipt = await tx.wait();

            return {
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                vaultId: vaultId
            };
        } catch (error) {
            console.error('❌ Error confirming death:', error);
            throw error;
        }
    }
    /**
     * Execute a vault on-chain (mark as Executed).
     * Any caller is allowed by the contract (relayer pays gas), but backend guarantees
     * the address corresponds to an authorized beneficiary.
     * @param {string} beneficiaryAddress - Verified beneficiary address (recovered from authSig by caller)
     */
    async executeVault(beneficiaryAddress, vaultId) {
        try {
            console.log(`✅ Executing vault ${vaultId} on behalf of beneficiary ${beneficiaryAddress}`);

            const isBen = await this.contract.isBeneficiary(vaultId, beneficiaryAddress);
            if (!isBen) {
                throw new Error("Unauthorized: Mnemonic does not belong to a beneficiary of this vault");
            }

            // Use the relayer to execute (saves beneficiary from needing gas)
            const tx = await this.contract.executeVault(vaultId);
            const receipt = await tx.wait();

            return {
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                vaultId: vaultId
            };
        } catch (error) {
            console.error('❌ Error in executeVault:', error);
            throw error;
        }
    }
}

module.exports = AvalancheManager;
