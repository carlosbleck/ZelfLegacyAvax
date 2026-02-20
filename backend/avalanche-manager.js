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
     */
    async createVault(
        testatorMnemonic,
        vaultId,
        beneficiaries,
        lawyer,
        heartbeatInterval,
        ipfsCid,
        ipfsCidValidator
    ) {
        try {
            const testatorAddress = this.getAddressFromMnemonic(testatorMnemonic);

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
     */
    async updateHeartbeat(testatorMnemonic, vaultId) {
        try {
            const testatorAddress = this.getAddressFromMnemonic(testatorMnemonic);
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
     */
    async cancelVault(testatorMnemonic, vaultId) {
        try {
            const testatorAddress = this.getAddressFromMnemonic(testatorMnemonic);
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
     */
    async changeLawyer(testatorMnemonic, vaultId, newLawyer) {
        try {
            const testatorAddress = this.getAddressFromMnemonic(testatorMnemonic);
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
     * Fund a wallet with gas from the relayer if its balance is too low.
     * This is needed because lawyer wallets derived from mnemonics typically have no gas.
     */
    async fundWalletIfNeeded(walletAddress, minBalance = ethers.parseEther('0.01')) {
        const balance = await this.provider.getBalance(walletAddress);
        if (balance < minBalance) {
            const fundAmount = ethers.parseEther('0.05');
            console.log(`💰 Funding ${walletAddress} with 0.05 AVAX for gas (current balance: ${ethers.formatEther(balance)})`);
            const tx = await this.relayerWallet.sendTransaction({
                to: walletAddress,
                value: fundAmount
            });
            await tx.wait();
            console.log(`✅ Funded ${walletAddress} in tx ${tx.hash}`);
        } else {
            console.log(`💰 ${walletAddress} already has sufficient balance: ${ethers.formatEther(balance)}`);
        }
    }

    /**
     * Accept a vault (Lawyer only)
     * Contract requires msg.sender == vault.lawyer, so the lawyer must sign directly.
     * The relayer funds the lawyer wallet with gas before the transaction.
     */
    async acceptVault(lawyerMnemonic, vaultId) {
        try {
            const lawyerAddress = this.getAddressFromMnemonic(lawyerMnemonic);
            console.log(`⚖️ Accepting vault ${vaultId} as lawyer ${lawyerAddress}`);

            // Fund the lawyer wallet from relayer so it can pay gas
            await this.fundWalletIfNeeded(lawyerAddress);

            const lawyerWallet = new ethers.Wallet(ethers.Wallet.fromPhrase(lawyerMnemonic).privateKey, this.provider);
            const contractWithLawyer = this.contract.connect(lawyerWallet);

            const tx = await contractWithLawyer.acceptVault(vaultId);
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
     */
    async rejectVault(lawyerMnemonic, vaultId) {
        try {
            const lawyerAddress = this.getAddressFromMnemonic(lawyerMnemonic);
            console.log(`⚖️ Rejecting vault ${vaultId} as lawyer ${lawyerAddress}`);

            // Fund the lawyer wallet from relayer so it can pay gas
            await this.fundWalletIfNeeded(lawyerAddress);

            const lawyerWallet = new ethers.Wallet(ethers.Wallet.fromPhrase(lawyerMnemonic).privateKey, this.provider);
            const contractWithLawyer = this.contract.connect(lawyerWallet);

            const tx = await contractWithLawyer.rejectVault(vaultId);
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
     * Contract requires msg.sender == vault.lawyer.
     */
    async confirmDeath(lawyerMnemonic, vaultId) {
        try {
            const lawyerAddress = this.getAddressFromMnemonic(lawyerMnemonic);
            console.log(`⚰️ Confirming death for vault ${vaultId} as lawyer ${lawyerAddress}`);

            // Fund the lawyer wallet from relayer so it can pay gas
            await this.fundWalletIfNeeded(lawyerAddress);

            const lawyerWallet = new ethers.Wallet(ethers.Wallet.fromPhrase(lawyerMnemonic).privateKey, this.provider);
            const contractWithLawyer = this.contract.connect(lawyerWallet);

            const tx = await contractWithLawyer.confirmDeath(vaultId);
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
     * Any caller is allowed by the contract as long as isClaimable is true.
     * Uses the relayer to pay gas fees.
     */
    async executeVault(beneficiaryMnemonic, vaultId) {
        try {
            const beneficiaryAddress = this.getAddressFromMnemonic(beneficiaryMnemonic);
            console.log(`✅ Executing vault ${vaultId} on behalf of beneficiary ${beneficiaryAddress}`);

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
