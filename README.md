<div align="center">

<img src="https://img.shields.io/badge/Shelby_Protocol-Powered-0891b2?style=for-the-badge" alt="Shelby Protocol"/>
<img src="https://img.shields.io/badge/Aptos-Testnet-4f46e5?style=for-the-badge" alt="Aptos"/>
<img src="https://img.shields.io/badge/Solidity-0.8.20-363636?style=for-the-badge&logo=solidity&logoColor=white" alt="Solidity"/>
<img src="https://img.shields.io/badge/License-MIT-10b981?style=for-the-badge" alt="MIT"/>

<br/>
<br/>

# ⬡ Blink Share

### Decentralized · Encrypted · Self-Expiring File Transfer

*A trustless Web3 alternative to WeTransfer, built on Shelby Protocol.*

· [Report Bug](../../issues) · [Request Feature](../../issues)

</div>

---

## Overview

Blink Share lets you upload any file, generate a shareable link, and have that link cryptographically expire — enforced by a smart contract, not a promise.

**The key insight:** your file is AES-256-GCM encrypted in your browser *before* it leaves your device. The decryption key lives only in the URL `#fragment` — the part browsers never transmit to servers. Not even the backend can read your files.

```
You upload  →  Browser encrypts  →  Wallet signs contract tx  →  Shelby stores ciphertext
Recipient opens link  →  Browser reads key from #fragment  →  Decrypts locally  →  Downloads
```

---

## Features

| | Feature | Description |
|---|---|---|
| 🔐 | **E2E Encryption** | AES-256-GCM via Web Crypto API — key never leaves the browser |
| ⏱ | **On-Chain Expiry** | Smart contract enforces expiry; `validateAccess()` reverts after deadline |
| 🛡️ | **Password Protection** | `keccak256(salt, password)` on-chain — plaintext never touches the chain |
| 👛 | **Wallet Allowlist** | Restrict to specific wallets, verified via cryptographic signature |
| ⚡ | **One-Time Links** | Contract auto-revokes after the first successful download |
| 💎 | **Pay-Per-Upload** | Micro-payment per KB — anti-spam by design |
| ⬡ | **Shelby Storage** | Erasure-coded blobs replicated across 3+ distributed Shelby nodes |
| 📊 | **On-Chain Analytics** | Download count tracked on-chain; tamper-proof |

---

## Project Structure

```
blink-share/
├── .env.example                    ← Environment variable template
├── .gitignore
├── hardhat.config.js               ← Network config (localhost, Sepolia, Aptos EVM)
├── package.json                    ← Root workspace (Hardhat dev tooling)
│
├── contracts/
│   └── BlinkShare.sol              ← Solidity smart contract
│
├── scripts/
│   └── deploy.js                   ← Hardhat deploy → auto-writes ABI to frontend + backend
│
├── test/
│   └── BlinkShare.test.js          ← 16 contract tests (Hardhat + Chai)
│
├── backend/
│   ├── package.json                ← Backend deps (@shelby/sdk, express, ethers…)
│   ├── src/
│   │   └── server.js               ← Express API server
│   └── utils/
│       ├── shelby.js               ← ShelbyNodeClient wrapper + Geomi API key setup
│       └── encryption.js           ← AES-256-GCM server-side helpers
│
└── frontend/
    └── index.html                  ← Full landing page + app UI (zero build step)
```

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  BROWSER                                                          │
│  1. Generate AES-256-GCM key (Web Crypto API)                     │
│  2. Encrypt file → encrypted buffer                               │
│  3. Wallet signs BlinkShare.uploadFile() transaction              │
│  4. POST encrypted buffer to backend → receives CID               │
│  5. Share URL: /d/<fileId>#<base64url-key>                        │
│                             ↑ fragment NEVER sent to any server   │
└────────────────┬──────────────────────────────┬───────────────────┘
                 │                              │
                 ▼                              ▼
  ┌──────────────────────────┐    ┌─────────────────────────────┐
  │  BlinkShare.sol          │    │  Backend (Express / Node)   │
  │                          │    │                             │
  │  • fileId → CID hash     │    │  Receives encrypted blob    │
  │  • owner address         │    │  ShelbyNodeClient.upload()  │
  │  • expiresAt timestamp   │    │  Returns CID to browser     │
  │  • passwordHash          │    │  Proxies encrypted downloads│
  │  • downloadCount         │    │  Validates signed requests  │
  │  • revoked flag          │    └──────────────┬──────────────┘
  └──────────────────────────┘                   │
                                                 ▼
                                    ┌────────────────────────────┐
                                    │  Shelby Hot Storage        │
                                    │  Erasure-coded 3+ nodes    │
                                    │  TTL-aware GC              │
                                    │  Geomi API authentication  │
                                    └────────────────────────────┘
```

---

## Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18.x |
| npm | ≥ 9.x |
| MetaMask | Latest |
| Geomi account | [geomi.dev](https://geomi.dev) |

### 1. Clone

```bash
git clone https://github.com/your-username/blink-share.git
cd blink-share
```

### 2. Install dependencies

```bash
npm install              # Hardhat + tooling
cd backend && npm install && cd ..
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 4. Get Shelby API keys

1. Visit **[geomi.dev](https://geomi.dev)** → sign in
2. Click **"API Resource"** → Network: **Testnet** → submit
3. Copy the key (`aptoslabs_***`)
   - **Private key** → `SHELBY_API_KEY` in `.env` (backend)
   - **Client key** → `SHELBY_CLIENT_KEY` in `.env` + `CONFIG.SHELBY_CLIENT_KEY` in `frontend/index.html`

> **Local dev:** set `SHELBY_MOCK=true` — files stored in memory, no key needed.

### 5. Deploy the contract

```bash
# Local
npx hardhat node &
npx hardhat run scripts/deploy.js --network localhost

# Sepolia testnet (get ETH at https://sepoliafaucet.com)
npx hardhat run scripts/deploy.js --network sepolia
```

The deploy script auto-writes the contract address and ABI to `backend/src/contract.json`. Then update `CONFIG.CONTRACT_ADDRESS` in `frontend/index.html`.

### 6. Start the backend

```bash
cd backend && npm start
# Runs at http://localhost:4000
```

### 7. Open the frontend

```bash
# No build step needed — open directly
open frontend/index.html

# Or serve with any static server
npx serve frontend/
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SHELBY_API_KEY` | Production | Private server key from geomi.dev (`aptoslabs_***`) |
| `SHELBY_CLIENT_KEY` | Production | Browser-safe client key from Geomi |
| `SHELBY_NETWORK` | Yes | `testnet` \| `mainnet` \| `devnet` |
| `SHELBY_MOCK` | Dev | `true` to use in-memory mock (no key needed) |
| `SHELBY_TIMEOUT` | No | Request timeout ms (default `30000`) |
| `SHELBY_REPLICA` | No | Fallback gateway URL |
| `RPC_URL` | Yes | JSON-RPC endpoint (default `http://127.0.0.1:8545`) |
| `CONTRACT_ADDRESS` | Yes | Deployed contract address (auto-set by deploy script) |
| `DEPLOYER_PRIVATE_KEY` | Deploy | Wallet key for contract deployment |
| `BACKEND_PRIVATE_KEY` | Production | Backend signer wallet key |
| `SEPOLIA_RPC_URL` | Sepolia | Alchemy or Infura Sepolia RPC |
| `PORT` | No | Backend port (default `4000`) |
| `MAX_FILE_SIZE` | No | Max upload bytes (default `104857600` = 100 MB) |
| `FRONTEND_URL` | Production | Frontend origin for CORS |

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service + Shelby node health |
| `POST` | `/api/upload` | Upload encrypted blob to Shelby |
| `GET` | `/api/download/:cid` | Proxy encrypted blob from Shelby |
| `GET` | `/api/file/:fileId` | On-chain file metadata |
| `POST` | `/api/verify/:fileId` | Verify access (password / wallet) |
| `DELETE` | `/api/shelby/:cid` | Early deletion signal (signed request) |

---

## Smart Contract

### `uploadFile()`

```solidity
function uploadFile(
    string  calldata cid,             // Shelby content identifier
    string  calldata fileName,
    string  calldata mimeType,
    uint64           fileSizeKb,      // Used to calculate payment
    uint64           expirySeconds,   // 60 – 2,592,000 (1 min – 30 days)
    bytes32          passwordHash,    // keccak256(salt, password) or bytes32(0)
    address[] calldata allowedWallets,// Empty = public
    bool             oneTimeLink
) external payable returns (bytes32 fileId)
```

**Cost:** `pricePerKb × fileSizeKb` wei (default `0.000001 ETH/KB`)

### Other functions

| Function | Access | Description |
|---|---|---|
| `validateAccess(fileId, passwordHash)` | Public | Checks expiry, password, allowlist. Increments counter. |
| `revokeFile(fileId)` | Owner | Immediately marks file revoked on-chain |
| `getFileMeta(fileId)` | Public | Returns all public metadata |
| `getOwnerFiles(address)` | Public | Returns all fileIds for a wallet |
| `getUploadCost(fileSizeKb)` | Public | Preview upload cost in wei |

---

## Running Tests

```bash
npx hardhat test
```

```
BlinkShare
  uploadFile()
    ✔ registers a file and emits FileUploaded
    ✔ reverts with InsufficientPayment when underpaying
    ✔ reverts with InvalidExpiry when expiry < 60s
    ✔ reverts with InvalidExpiry when expiry > 30 days
    ✔ reverts with ZeroSize when fileSizeKb is 0
  validateAccess()
    ✔ grants access to a public file
    ✔ increments downloadCount on each access
  Password protection
    ✔ grants access with correct password hash
    ✔ denies access with wrong password hash
  revokeFile()
    ✔ allows owner to revoke
    ✔ blocks access after revocation
    ✔ prevents non-owner from revoking
  One-time links
    ✔ allows first download
    ✔ blocks second download
  Admin
    ✔ allows admin to update price
    ✔ allows admin to withdraw collected fees

16 passing
```

---

## Upload → Share → Expire: Full Flow

```
1. Select file in browser
   │
2. Browser generates AES-256-GCM key (Web Crypto API)
   Browser encrypts file → ciphertext only leaves the device
   │
3. MetaMask signs BlinkShare.uploadFile() transaction
   Contract records: fileId, owner, expiresAt, passwordHash
   │
4. Backend receives encrypted buffer
   ShelbyNodeClient.upload() → distributed across 3+ nodes → CID returned
   │
5. Browser builds shareable link:
   https://app.com/d/<fileId>#<base64url-aes-key>
                                ↑ key lives ONLY here, never transmitted
   │
6. Recipient opens link
   Browser extracts key from URL fragment
   GET /api/download/:cid → receives encrypted blob
   BlinkShare.validateAccess() → confirms not expired, not revoked
   Browser decrypts locally → triggers download
   │
7. After expiry (e.g. 24 hours):
   validateAccess() reverts with FileExpiredOrRevoked
   Shelby TTL garbage-collects blob from all nodes
   File is permanently and cryptographically inaccessible
```

---

## Security Model

| Threat | Mitigation |
|---|---|
| Server reads files | Encrypted in browser before upload; server only stores ciphertext |
| Key interception in transit | Delivered via `#fragment`; HTTP never transmits URL fragments to servers |
| Link stays valid after expiry | `block.timestamp > expiresAt` in contract; immutable on-chain |
| Password brute-force | `keccak256(salt, password)`; salt defeats rainbow tables |
| Unauthorized wallet access | `ecrecover` signature verification; enforced in contract |
| Spam / abuse | Pay-per-KB micro-payment; economically unviable to spam |
| Storage outage | Erasure-coded across 3+ independent Shelby nodes |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML/CSS/JS · Syne + DM Mono · ethers.js v6 (CDN, no build needed) |
| Backend | Node.js 18 · Express · `@shelby/sdk` · `@aptos-labs/ts-sdk` · ethers v6 |
| Contract | Solidity 0.8.20 · Hardhat · Gas-optimised custom errors |
| Storage | Shelby Protocol · Geomi API auth · Erasure coding |
| Chain | Aptos EVM / Sepolia testnet |
| Testing | Hardhat · Chai · Mocha |

---

## Deployment Checklist

- [ ] Geomi API keys acquired at [geomi.dev](https://geomi.dev)
- [ ] `SHELBY_API_KEY` and `SHELBY_CLIENT_KEY` set in `.env`
- [ ] Contract deployed and `CONTRACT_ADDRESS` set in `.env` + `frontend/index.html`
- [ ] Backend running and reachable from the frontend origin
- [ ] `FRONTEND_URL` set for CORS
- [ ] Frontend served over **HTTPS** (required by Web Crypto API in production)
- [ ] MetaMask configured to the correct network

---

## Contributing

1. Fork the repo and create a branch: `git checkout -b feature/your-feature`
2. Make changes and verify: `npx hardhat test`
3. Open a Pull Request against `main` with a clear description

Please match the existing code style and keep commits atomic.

---

## Roadmap

- [ ] File preview (images/PDFs) — decrypt → render in sandboxed iframe
- [ ] Multi-file bundle uploads
- [ ] Download analytics dashboard
- [ ] Docker Compose for one-command local setup
- [ ] Mainnet deployment guide

---

## License

MIT — see [LICENSE](LICENSE) for details.

> ⚠️ Not audited. Use on mainnet at your own risk.

---

<div align="center">

Built with ⬡ on [Shelby Protocol](https://shelby.xyz) · [geomi.dev](https://geomi.dev) · [aptos.dev](https://aptos.dev)

</div>
