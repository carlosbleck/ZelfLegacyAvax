# ZelfLegacyAvax

Phase 1 implementation of the Inheritance System on Avalanche C-Chain.

## Project Structure

- `contracts/`: Hardhat project for Smart Contracts.
- `backend/`: Node.js/Express backend for relaying metadata and monitoring.

## 1. Smart Contracts

Located in `contracts/`.

### Setup
```bash
cd contracts
npm install
```

### Compile
```bash
npx hardhat compile
```
*Note: if you encounter "ESM" errors, verify `package.json` does NOT have `"type": "module"` and use `hardhat.config.js`.*

### Deploy to Fuji Testnet
1. Set `PRIVATE_KEY` in `.env`.
2. Run:
```bash
npx hardhat run scripts/deploy.js --network fuji
```

## 2. Backend Server

Located in `backend/`.

### Setup
```bash
cd backend
npm install
```

### Run
```bash
node server.js
```

### API Endpoints
- `POST /api/vaults/create`: Log new vault creation.
- `GET /api/vaults/:id`: Get vault status.
