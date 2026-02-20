// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title VaultRegistry
 * @dev Manages inheritance vaults on Avalanche C-Chain (UUPS Upgradeable).
 *      Stores metadata and access control logic.
 *      NO SECRETS are stored here. Only hashes and references (CIDs).
 */
contract VaultRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    
    // Enum for vault state
    enum VaultState {
        PendingLawyer, // Initial state, waiting for lawyer acceptance
        Active,        // Lawyer accepted, vault is active, heartbeat is valid
        Warning,       // Heartbeat missed (grace period)
        Claimable,     // Heartbeat timeout reached, claimable by beneficiaries
        Executed,      // Vault has been executed/claimed
        Rejected,      // Lawyer rejected the request
        Cancelled      // Testator cancelled the will
    }

    struct Vault {
        bytes32 vaultId;            // Unique ID derived from user data
        address owner;              // Testator address
        address[] beneficiaries;    // Beneficiary addresses
        address lawyer;             // Lawyer address
        uint256 threshold;          // Shamir threshold (k-of-n)
        uint256 heartbeatInterval;  // Seconds between required heartbeats
        uint256 lastPing;           // Timestamp of last heartbeat
        uint256 createdAt;          // Timestamp of vault creation
        uint256 activationDate;     // Timestamp when lawyer accepted (active)
        string ipfsCid;             // CID of encrypted vault data (.legacywill)
        string ipfsCidValidator;    // CID of validation/share data (.legacyparty/.legacylawyer)
        bool exists;                // Flag to check existence
        VaultState state;           // Current state of the vault
    }

    address public relayer;         // Central wallet to perform fees

    modifier onlyRelayer() {
        require(msg.sender == relayer, "Only relayer can perform this action");
        _;
    }

    // Mapping from Vault ID to Vault struct
    mapping(bytes32 => Vault) public vaults;
    
    // Mapping from Owner address to their Vault IDs
    mapping(address => bytes32[]) public userVaults;
    
    // Mapping from Lawyer address to pending/active Vault IDs
    mapping(address => bytes32[]) public lawyerVaults;

    // Mapping from Beneficiary address to Vault IDs they are part of
    mapping(address => bytes32[]) public beneficiaryVaults;

    // Events
    event VaultCreated(bytes32 indexed vaultId, address indexed owner, address indexed lawyer);
    event VaultAccepted(bytes32 indexed vaultId, address indexed lawyer);
    event VaultRejected(bytes32 indexed vaultId, address indexed lawyer);
    event HeartbeatUpdated(bytes32 indexed vaultId, uint256 lastPing);
    event DeathConfirmed(bytes32 indexed vaultId, address indexed lawyer);
    event VaultCancelled(bytes32 indexed vaultId, address indexed owner);
    event VaultExecuted(bytes32 indexed vaultId, address indexed beneficiary);
    event LawyerChanged(bytes32 indexed vaultId, address indexed oldLawyer, address indexed newLawyer);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract (replaces constructor for UUPS proxy).
     * @param _initialOwner The address that will be the owner (upgrade authority)
     */
    function initialize(address _initialOwner) public initializer {
        __Ownable_init(_initialOwner);
        __UUPSUpgradeable_init();
        relayer = _initialOwner; // Initial relayer is the owner
    }

    /**
     * @dev Required by UUPSUpgradeable. Only the owner can authorize an upgrade.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function setRelayer(address _newRelayer) external {
        require(msg.sender == relayer || msg.sender == owner(), "Only relayer or owner can update");
        relayer = _newRelayer;
    }

    /**
     * @dev Create a new inheritance vault.
     * @param _owner The address of the testator
     * @param _vaultId Unique identifier for the vault
     * @param _beneficiaries List of beneficiary addresses
     * @param _lawyer Lawyer's address
     * @param _heartbeatInterval Interval in seconds for liveness check
     * @param _ipfsCid IPFS CID for the encrypted will
     * @param _ipfsCidValidator IPFS CID for validation/share data
     */
    function createVault(
        address _owner,
        bytes32 _vaultId,
        address[] memory _beneficiaries,
        address _lawyer,
        uint256 _threshold,
        uint256 _heartbeatInterval,
        string memory _ipfsCid,
        string memory _ipfsCidValidator
    ) external {
        require(msg.sender == _owner || msg.sender == relayer, "Not authorized to create vault");
        require(!vaults[_vaultId].exists, "Vault already exists");
        require(_threshold > 0 && _threshold <= _beneficiaries.length + 1, "Invalid threshold");
        require(_heartbeatInterval > 0, "Invalid heartbeat interval");
        require(_lawyer != address(0), "Lawyer address cannot be zero");

        Vault storage newVault = vaults[_vaultId];
        newVault.vaultId = _vaultId;
        newVault.owner = _owner;
        newVault.beneficiaries = _beneficiaries;
        newVault.lawyer = _lawyer;
        newVault.threshold = _threshold;
        newVault.heartbeatInterval = _heartbeatInterval;
        newVault.lastPing = block.timestamp;
        newVault.createdAt = block.timestamp;
        newVault.activationDate = 0;
        newVault.ipfsCid = _ipfsCid;
        newVault.ipfsCidValidator = _ipfsCidValidator;
        newVault.exists = true;
        newVault.state = VaultState.PendingLawyer;

        userVaults[_owner].push(_vaultId);
        lawyerVaults[_lawyer].push(_vaultId);

        // Add to beneficiary mappings
        for (uint256 i = 0; i < _beneficiaries.length; i++) {
            beneficiaryVaults[_beneficiaries[i]].push(_vaultId);
        }

        emit VaultCreated(_vaultId, _owner, _lawyer);
    }

    /**
     * @dev Lawyer accepts the vault responsibility.
     * @param _vaultId The vault ID to accept
     */
    function acceptVault(bytes32 _vaultId) external {
        Vault storage vault = vaults[_vaultId];
        require(vault.exists, "Vault does not exist");
        require(msg.sender == vault.lawyer || msg.sender == relayer, "Not authorized to accept");
        require(vault.state == VaultState.PendingLawyer, "Vault not in pending state");

        vault.state = VaultState.Active;
        vault.lastPing = block.timestamp; // Reset heartbeat on acceptance
        vault.activationDate = block.timestamp;
        
        emit VaultAccepted(_vaultId, vault.lawyer);
    }

    /**
     * @dev Lawyer rejects the vault request.
     * @param _vaultId The vault ID to reject
     */
    function rejectVault(bytes32 _vaultId) external {
        Vault storage vault = vaults[_vaultId];
        require(vault.exists, "Vault does not exist");
        require(msg.sender == vault.lawyer || msg.sender == relayer, "Not authorized to reject");
        require(vault.state == VaultState.PendingLawyer, "Vault not in pending state");

        vault.state = VaultState.Rejected;
        
        emit VaultRejected(_vaultId, vault.lawyer);
    }

    /**
     * @dev Update the heartbeat timestamp.
     * @param _vaultId The vault ID to update
     */
    function updateHeartbeat(bytes32 _vaultId) external {
        Vault storage vault = vaults[_vaultId];
        require(vault.exists, "Vault does not exist");
        require(msg.sender == vault.owner || msg.sender == relayer, "Not authorized");
        require(vault.state == VaultState.Active || vault.state == VaultState.Warning, "Invalid state");

        vault.lastPing = block.timestamp;
        vault.state = VaultState.Active; // Reset state if it was in Warning
        emit HeartbeatUpdated(_vaultId, block.timestamp);
    }

    /**
     * @dev Lawyer confirms testator is gone.
     * @param _vaultId The vault ID to confirm
     */
    function confirmDeath(bytes32 _vaultId) external {
        Vault storage vault = vaults[_vaultId];
        require(vault.exists, "Vault does not exist");
        require(msg.sender == vault.lawyer || msg.sender == relayer, "Not authorized to confirm death");
        require(vault.state == VaultState.Active || vault.state == VaultState.Warning, "Vault not in active state");

        vault.state = VaultState.Claimable;
        
        emit DeathConfirmed(_vaultId, vault.lawyer);
    }

    /**
     * @dev Owner cancels the vault.
     * @param _vaultId The vault ID to cancel
     */
    function cancelVault(bytes32 _vaultId) external {
        Vault storage vault = vaults[_vaultId];
        require(vault.exists, "Vault does not exist");
        require(msg.sender == vault.owner || msg.sender == relayer, "Not authorized");
        require(
            vault.state == VaultState.PendingLawyer || 
            vault.state == VaultState.Active || 
            vault.state == VaultState.Warning,
            "Cannot cancel vault in current state"
        );

        vault.state = VaultState.Cancelled;
        
        emit VaultCancelled(_vaultId, vault.owner);
    }

    /**
     * @dev Owner changes the lawyer if the current one is unresponsive.
     * @param _vaultId The vault ID
     * @param _newLawyer The new lawyer's address
     */
    function changeLawyer(bytes32 _vaultId, address _newLawyer) external {
        Vault storage vault = vaults[_vaultId];
        require(vault.exists, "Vault does not exist");
        require(msg.sender == vault.owner || msg.sender == relayer, "Not authorized to change lawyer");
        require(vault.state == VaultState.PendingLawyer, "Vault not in pending state");
        require(_newLawyer != address(0), "Lawyer address cannot be zero");

        address oldLawyer = vault.lawyer;
        vault.lawyer = _newLawyer;
        vault.createdAt = block.timestamp; // Reset timeout
        
        // Remove from old lawyer
        bytes32[] storage oldList = lawyerVaults[oldLawyer];
        for (uint256 i = 0; i < oldList.length; i++) {
            if (oldList[i] == _vaultId) {
                oldList[i] = oldList[oldList.length - 1];
                oldList.pop();
                break;
            }
        }
        
        // Add to new lawyer
        lawyerVaults[_newLawyer].push(_vaultId);

        emit LawyerChanged(_vaultId, oldLawyer, _newLawyer);
    }

    /**
     * @dev Check if a vault is claimable.
     * @param _vaultId The vault ID to check
     * @return bool True if claimable
     */
    function isClaimable(bytes32 _vaultId) external view returns (bool) {
        Vault storage vault = vaults[_vaultId];
        if (!vault.exists) {
            return false;
        }
        if (vault.state == VaultState.Claimable || vault.state == VaultState.Executed) {
            return true;
        }
        if (vault.state == VaultState.PendingLawyer) {
            // Also use heartbeatInterval for lawyer acceptance timeout
            return block.timestamp > (vault.createdAt + vault.heartbeatInterval);
        }
        if (vault.state != VaultState.Active && vault.state != VaultState.Warning) {
            return false;
        }
        return block.timestamp > (vault.lastPing + vault.heartbeatInterval);
    }

    /**
     * @dev Mark the vault as executed.
     * @param _vaultId The vault ID to execute
     */
    function executeVault(bytes32 _vaultId) external {
        Vault storage vault = vaults[_vaultId];
        require(vault.exists, "Vault does not exist");
        require(this.isClaimable(_vaultId), "Vault is not claimable yet");
        require(
            vault.state == VaultState.Active || 
            vault.state == VaultState.Warning ||
            vault.state == VaultState.Claimable, 
            "Invalid state for execution"
        );

        require(isBeneficiary(_vaultId, msg.sender) || msg.sender == relayer, "Only beneficiary or relayer can execute");

        vault.state = VaultState.Executed;
        
        emit VaultExecuted(_vaultId, msg.sender);
    }

    /**
     * @dev Check if a user is a beneficiary of a vault.
     */
    function isBeneficiary(bytes32 _vaultId, address _user) public view returns (bool) {
        Vault storage vault = vaults[_vaultId];
        for (uint256 i = 0; i < vault.beneficiaries.length; i++) {
            if (vault.beneficiaries[i] == _user) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Get vault details.
     */
    function getVault(bytes32 _vaultId) external view returns (Vault memory) {
        return vaults[_vaultId];
    }

    /**
     * @dev Get all vault IDs for a beneficiary.
     */
    function getBeneficiaryVaults(address _beneficiary) external view returns (bytes32[] memory) {
        return beneficiaryVaults[_beneficiary];
    }

    /**
     * @dev Get all vault IDs for a lawyer.
     */
    function getLawyerVaults(address _lawyer) external view returns (bytes32[] memory) {
        return lawyerVaults[_lawyer];
    }

    /**
     * @dev Get all vault IDs for an owner (testator).
     */
    function getUserVaults(address _owner) external view returns (bytes32[] memory) {
        return userVaults[_owner];
    }
}
