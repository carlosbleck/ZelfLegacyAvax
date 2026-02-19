# ❄️ ZelfLegacyAvax

**Phase 1 implementation of the Inheritance System on Avalanche C-Chain.**

ZelfLegacyAvax is a decentralized inheritance protocol designed to ensure your digital assets are securely handled and transitioned to beneficiaries. Using a combination of **Avalanche C-Chain** smart contracts, **Lit Protocol** for decentralized encryption, and **Shamir's Secret Sharing**, it provides a robust framework for asset legacy management.

---

## 🏗️ Project Architecture

The project is divided into two main components:

- **`contracts/`**: A Hardhat-based project containing the core Smart Contracts that govern vault creation, state management, and lawyer approvals.
- **`backend/`**: A Node.js/Express service that facilitates interactions with the Avalanche network, manages Lit Protocol encryption sessions, and coordinates Shamir shares through an API.

---

## 🛠️ Core Technologies

- **Avalanche C-Chain**: Low-latency, high-throughput blockchain for state management.
- **Lit Protocol**: Enables decentralized programmatic encryption and access control.
- **Shamir's Secret Sharing (SSS)**: Distributes "shares" of a secret among multiple parties (Lawyers/Beneficiaries) so that only a threshold can reconstruct it.
- **Ethers.js v6**: For robust blockchain interactions.

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
1. Create a `.env` file based on `.env.example`.
2. Set your `PRIVATE_KEY`.
3. Run:
```bash
npx hardhat run scripts/deploy.js --network fuji
```

### 2. Backend Server

Located in the `backend/` directory.

#### Setup & Environment
```bash
cd backend
npm install
```
Configure your `.env` with Avalanche RPC URLs, private keys, and Lit Protocol network settings.

#### Running the Server
```bash
# Start the development server
node server.js
```

---

## 📡 API Endpoints (Backend)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/vaults/create` | Initializes a new vault and logs it to the system. |
| `GET` | `/api/vaults/:id` | Retrieves the current state and details of a specific vault. |
| `POST` | `/api/auth/session` | Generates a Lit Protocol auth session for encryption. |

---

## 📝 License

This project is licensed under the ISC License.
