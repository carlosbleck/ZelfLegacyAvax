# ZelfLegacy Backend

Backend service for the ZelfLegacy inheritance system, handling Lit Protocol encryption and IPFS storage via Pinata.

## Features

- **Lit Protocol Integration**: Encrypts password shares with decentralized access control
- **IPFS Storage**: Uploads encrypted shares to IPFS via Pinata
- **Access Gating**: Shares are only decryptable when `VaultRegistry.isClaimable() == true`
- **Avalanche Integration**: Works with VaultRegistry smart contract on Avalanche C-Chain

## Setup

1. **Install Dependencies**
```bash
npm install
```

2. **Configure Environment**
```bash
cp .env.example .env
# Edit .env with your credentials
```

Required environment variables:
- `PINATA_API_KEY`: Your Pinata API key
- `PINATA_SECRET_KEY`: Your Pinata secret key
- `VAULT_REGISTRY_ADDRESS`: Deployed VaultRegistry contract address
- `PORT`: Server port (default: 3000)

3. **Start Server**
```bash
node server.js
```

## API Endpoints

### POST `/api/vault/encrypt-shares`
Encrypts password shares using Lit Protocol and uploads to IPFS.

**Request Body:**
```json
{
  "passwordparty": "share1_data",
  "passwordlawyer": "share2_data",
  "vaultId": "0x123...",
  "contractAddress": "0xabc..."
}
```

**Response:**
```json
{
  "success": true,
  "passwordpartyCID": "Qm...",
  "passwordlawyerCID": "Qm...",
  "manifestCID": "Qm..."
}
```

### POST `/api/vault/decrypt-share`
Decrypts a password share (requires valid authSig and claimable vault).

**Request Body:**
```json
{
  "cid": "Qm...",
  "vaultId": "0x123...",
  "contractAddress": "0xabc...",
  "authSig": {...}
}
```

**Response:**
```json
{
  "success": true,
  "passwordShare": "decrypted_share_data"
}
```

### GET `/api/vault/manifest/:cid`
Retrieves the password shares manifest from IPFS.

**Response:**
```json
{
  "success": true,
  "manifest": {
    "passwordparty": "ipfs://Qm...",
    "passwordlawyer": "ipfs://Qm...",
    "version": "1.0",
    "type": "single-ben"
  }
}
```

### GET `/health`
Health check endpoint.

## Architecture

### Lit Protocol Flow
1. Password shares are encrypted with access control conditions
2. Conditions check `VaultRegistry.isClaimable(vaultId)`
3. Shares can only be decrypted after heartbeat expires or lawyer confirms death

### IPFS Storage
- `passwordparty`: Encrypted share for beneficiary
- `passwordlawyer`: Encrypted share for lawyer
- `manifest`: JSON file containing CIDs of both shares

## Security

- All password shares are encrypted via Lit Protocol before IPFS upload
- Access is gated by on-chain smart contract state
- Final mnemonic (`legacywill`) requires beneficiary's biometric face scan
