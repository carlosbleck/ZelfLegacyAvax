# ❄️ ZelfLegacyAvax

**Phase 1 implementation of the Inheritance System on Avalanche C-Chain.**

ZelfLegacyAvax is a decentralized inheritance protocol designed to ensure your digital assets are securely handled and transitioned to beneficiaries. Using a combination of **Avalanche C-Chain** smart contracts, **Lit Protocol** for decentralized encryption, and **Shamir's Secret Sharing**, it provides a robust framework for asset legacy management.

---

## 🏗️ Project Architecture

The project is divided into two main components:

- **`contracts/`**: A Hardhat-based project containing the core Smart Contracts (VaultRegistry) that govern vault creation, state management, and lawyer approvals. Uses OpenZeppelin UUPS upgradeable pattern.
- **`backend/`**: A Node.js/Express service that facilitates interactions with the Avalanche network, manages Lit Protocol encryption sessions, IPFS (Pinata) uploads, and coordinates Shamir shares through an API. Supports two modes: **full legacy server** (`server.js`) and **relayer server** (`server-relayer.js`).

---

## 🛠️ Core Technologies

- **Avalanche C-Chain**: Low-latency, high-throughput blockchain for state management.
- **Lit Protocol (v8/Naga)**: Decentralized programmatic encryption and access control; access gated by `VaultRegistry.isClaimable`.
- **Shamir's Secret Sharing (SSS)**: Distributes "shares" of a secret among multiple parties (Lawyers/Beneficiaries) so that only a threshold can reconstruct it.
- **IPFS (Pinata)**: Encrypted share and manifest storage.
- **Ethers.js v6**: For robust blockchain interactions.

---

## 📋 Vault State Machine

The `VaultRegistry` contract uses the following `VaultState` enum:

| State | Value | Description |
| :--- | :--- | :--- |
| PendingLawyer | 0 | Initial state, waiting for lawyer acceptance |
| Active | 1 | Lawyer accepted, vault is active, heartbeat valid |
| Warning | 2 | Heartbeat missed (grace period) |
| Claimable | 3 | Heartbeat timeout reached, claimable by beneficiaries |
| Executed | 4 | Vault has been executed/claimed |
| Rejected | 5 | Lawyer rejected the request |
| Cancelled | 6 | Testator cancelled the will |

---

## 🚀 Getting Started

### 1. Smart Contracts

Located in the `contracts/` directory.

#### Setup & Compilation
```bash
cd contracts
npm install
npx hardhat compile
```

#### Deployment to Fuji Testnet
```bash
# Standard deployment
npx hardhat run scripts/deploy.js --network fuji

# UUPS proxy deployment (upgradeable)
npm run deploy:proxy:fuji
```

#### Upgrade Existing Contract
```bash
npm run upgrade:fuji
```

### 2. Backend Server

Located in the `backend/` directory.

#### Setup & Environment
```bash
cd backend
npm install
```

Create a `.env` file with:

| Variable | Description |
| :--- | :--- |
| `PORT` | Server port (default: 3000) |
| `LEGACY_CLIENT_SECRET` | Required header `X-Zelf-Client-Secret` for `/api/` routes |
| `AVALANCHE_RPC_URL` | Avalanche C-Chain RPC (e.g. `https://api.avax-test.network/ext/bc/C/rpc`) |
| `VAULT_REGISTRY_ADDRESS` | Deployed VaultRegistry contract address |
| `RELAYER_PRIVATE_KEY` | Wallet used to sign and broadcast transactions |
| `PINATA_API_KEY` | Pinata API key for IPFS |
| `PINATA_SECRET_KEY` | Pinata secret key |
| `LIT_NETWORK` | Lit Protocol network (default: `nagaDev`) |
| `MAILGUN_API_KEY` | (Relayer) Mailgun API key for email notifications |
| `MAILGUN_DOMAIN` | (Relayer) Mailgun domain |

#### Running the Server

```bash
# Full legacy server (Lit, IPFS, Shamir, Avalanche)
npm run start:legacy
# or: node server.js

# Relayer server (tx relay + email notifications, used with Android WebView)
npm start
# or: node server-relayer.js
```

---

## 🔐 Authentication

- **Client key**: All `/api/` routes require the `X-Zelf-Client-Secret` header to match `LEGACY_CLIENT_SECRET`.
- **EIP-191 authSig**: Sensitive Avalanche operations (create-vault, update-heartbeat, confirm-death, etc.) require a signed message (`authSig`) with `sig`, `signedMessage`, and `address`. The message format is action-specific (e.g. `ZelfLegacy create-vault ${vaultId} ${beneficiaryAddresses[0]}`).

---

## 📡 API Endpoints

### Health

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Health check; returns `{ status: 'ok', service: '...' }`. |

### Vault (Lit + IPFS + Shamir)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/vault/encrypt-shares` | Encrypts password shares with Lit Protocol and uploads to IPFS. Body: `{ shares: [{ address, passwordparty, passwordlawyer }], vaultId, contractAddress }` |
| `POST` | `/api/vault/decrypt-share` | Decrypts a password share (requires valid `authSig`, beneficiary status). Body: `{ cid, vaultId, contractAddress, authSig }` |
| `POST` | `/api/vault/collect-shares` | Collects a beneficiary's Level 1 Shamir share for multi-party reconstruction. Body: `{ vaultId, beneficiaryAddress, partyShare, lawyerShare? }` |
| `GET` | `/api/vault/shares/:vaultId` | Returns collected Level 1 shares for a vault. |
| `GET` | `/api/vault/manifest/:cid` | Retrieves manifest from IPFS by CID. |
| `GET` | `/api/vault/manifest-by-vault/:vaultId` | Retrieves encrypted manifest from IPFS using on-chain `ipfsCidValidator`. |

### Avalanche (VaultRegistry)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/avalanche/create-vault` | Creates a new inheritance vault. Requires `authSig`, `beneficiaryAddresses`, `lawyerAddress?`, `heartbeatInterval?`, `ipfsCid`, `ipfsCidValidator`, `vaultId`, `threshold`. |
| `GET` | `/api/avalanche/vault/:vaultId` | Returns vault data for a given vault ID. |
| `POST` | `/api/avalanche/update-heartbeat` | Updates heartbeat (testator). Body: `{ authSig, vaultId }` |
| `POST` | `/api/avalanche/cancel-vault` | Cancels vault (testator). Body: `{ authSig, vaultId }` |
| `POST` | `/api/avalanche/change-lawyer` | Changes lawyer (testator). Body: `{ authSig, vaultId, newLawyerAddress }` |
| `POST` | `/api/avalanche/confirm-death` | Confirms death (lawyer). Body: `{ authSig, vaultId }` |
| `POST` | `/api/avalanche/accept-vault` | Lawyer accepts vault. Body: `{ authSig, vaultId }` |
| `POST` | `/api/avalanche/reject-vault` | Lawyer rejects vault. Body: `{ authSig, vaultId }` |
| `POST` | `/api/avalanche/execute-vault` | Marks vault as claimed (beneficiary). Body: `{ authSig, vaultId }` |
| `GET` | `/api/avalanche/execution-status/:vaultId` | Returns `executedCount`, `threshold`, and `fullyExecuted`. |
| `GET` | `/api/avalanche/owner-vaults/:address` | Vault IDs owned by testator. |
| `GET` | `/api/avalanche/beneficiary-vaults/:address` | Vault IDs where address is beneficiary. |
| `GET` | `/api/avalanche/beneficiary-vaults-data/:address` | Full vault data for all vaults where address is beneficiary. |
| `GET` | `/api/avalanche/lawyer-vaults/:address` | Vault IDs where address is lawyer. |

### Relayer (server-relayer.js only)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/relay/register-emails` | Stores emails for a vault before creation. Body: `{ vaultId, testatorEmail?, lawyerEmail?, beneficiaryEmails?, beneficiaryTagNames? }` |
| `POST` | `/api/relay/send-tx` | Relays a pre-built transaction; signs and broadcasts. Body: `{ to, calldata, value? }` |
| `POST` | `/api/relay/ipfs-upload` | Proxies Pinata JSON upload. Body: `{ data, filename? }` |
| `POST` | `/api/relay/collect-share` | Collects a beneficiary share (in-memory). |
| `GET` | `/api/relay/shares/:vaultId` | Returns collected shares for a vault. |
| `GET` | `/api/cron/check-vaults` | Cron endpoint: checks vault states, sends grace-period and liveness-failed emails. |
| `GET` | `/api/cron/notification-status` | Returns notification tracking state. |

---

## 🔗 Deployed Contracts (Fuji Testnet)

| Contract | Address | Explorer |
| :--- | :--- | :--- |
| VaultRegistry (Proxy) | `0x9D262070DbEc668B74eE328397F7A217569C69E1` | [Snowtrace](https://testnet.snowtrace.io/address/0x9D262070DbEc668B74eE328397F7A217569C69E1) |

Use this address for `VAULT_REGISTRY_ADDRESS` in your backend `.env` when connecting to Fuji.

---

## 📝 License

This project is licensed under the ISC License.
