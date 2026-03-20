/**
 * shelby.js - Shelby Hot Storage Integration
 * -------------------------------------------
 * Uses the official @shelby/sdk ShelbyNodeClient, authenticated via a Geomi API key.
 *
 * API Key Acquisition (geomi.dev):
 *   1. Visit https://geomi.dev and log in or create an account.
 *   2. On the overview page, click the "API Resource" card.
 *   3. Configure: Network = Testnet, provide a name and usage description.
 *   4. Copy the generated key (format: aptoslabs_***).
 *      - Server-side usage: use the default private key -> SHELBY_API_KEY in .env
 *      - Browser/client-side: generate a "client key" -> VITE_SHELBY_CLIENT_KEY
 *
 * Docs: https://geomi.dev/docs/api-keys | https://geomi.dev/docs/admin/billing
 */

"use strict";

const crypto = require("crypto");

// ---------------------------------------------------------------------------
//  SDK IMPORTS
//  @shelby/sdk  - Shelby node client with built-in auth + retry
//  @aptos-labs/ts-sdk - Provides Network enum consumed by ShelbyNodeClient
// ---------------------------------------------------------------------------

let ShelbyNodeClient, Network, AptosConfig, Aptos;
try {
  ({ ShelbyNodeClient } = require("@shelby/sdk"));
  ({ Network, AptosConfig, Aptos } = require("@aptos-labs/ts-sdk"));
} catch {
  console.warn(
    "[Shelby] SDK packages not installed.\n" +
    "         Run: npm install @shelby/sdk @aptos-labs/ts-sdk\n" +
    "         Falling back to mock mode regardless of SHELBY_MOCK setting."
  );
}

// ---------------------------------------------------------------------------
//  CONFIG
//  All values read from environment -- never hardcode API keys in source.
// ---------------------------------------------------------------------------

const SHELBY_API_KEY = process.env.SHELBY_API_KEY || "";  // aptoslabs_*** from geomi.dev
const SHELBY_NETWORK = process.env.SHELBY_NETWORK || "testnet";
const SHELBY_TIMEOUT = parseInt(process.env.SHELBY_TIMEOUT || "30000", 10);
const SHELBY_REPLICA = process.env.SHELBY_REPLICA || "";  // optional fallback gateway URL

// Validate key format at startup -- warns but never crashes the app
if (!SHELBY_API_KEY && process.env.SHELBY_MOCK !== "true") {
  console.warn(
    "[Shelby] WARNING: No SHELBY_API_KEY configured. Running in anonymous mode with lower rate limits.\n" +
    "         Get your key at https://geomi.dev and set SHELBY_API_KEY=aptoslabs_*** in .env"
  );
} else if (SHELBY_API_KEY && !SHELBY_API_KEY.startsWith("aptoslabs_")) {
  console.warn(
    "[Shelby] WARNING: SHELBY_API_KEY does not match the expected format (aptoslabs_***).\n" +
    "         Verify at https://geomi.dev/docs/api-keys"
  );
} else if (SHELBY_API_KEY) {
  const masked = SHELBY_API_KEY.slice(0, 14) + "***";
  console.log(`[Shelby] API key loaded (${masked}) -- network: ${SHELBY_NETWORK}`);
}

// ---------------------------------------------------------------------------
//  NETWORK RESOLVER
// ---------------------------------------------------------------------------

function resolveNetwork() {
  if (!Network) return null;
  const map = { testnet: Network.TESTNET, mainnet: Network.MAINNET, devnet: Network.DEVNET };
  const net = map[SHELBY_NETWORK.toLowerCase()];
  if (!net) {
    console.warn(`[Shelby] Unknown SHELBY_NETWORK "${SHELBY_NETWORK}", defaulting to TESTNET.`);
    return Network.TESTNET;
  }
  return net;
}

// ---------------------------------------------------------------------------
//  SHELBY CLIENT FACTORY
//
//  Instantiates ShelbyNodeClient with the Geomi API key:
//
//    const client = new ShelbyNodeClient({
//      network: Network.TESTNET,
//      apiKey: "aptoslabs_***",   // from geomi.dev -> API Resource -> private key
//    });
//
//  The client injects the key into every outgoing request automatically.
//  One instance is reused per process (lazy singleton).
// ---------------------------------------------------------------------------

function buildShelbyClient() {
  if (!ShelbyNodeClient || !Network) {
    throw new ShelbyError(
      "@shelby/sdk not available. Install: npm install @shelby/sdk @aptos-labs/ts-sdk"
    );
  }
  return new ShelbyNodeClient({
    network: resolveNetwork(),
    apiKey : SHELBY_API_KEY || undefined, // undefined = anonymous mode (not empty string)
  });
}

let _shelbyClient = null;
function getClient() {
  if (!_shelbyClient) _shelbyClient = buildShelbyClient();
  return _shelbyClient;
}

// ---------------------------------------------------------------------------
//  APTOS CLIENT  (optional - for chain reads alongside ethers.js)
//
//  Uses the same Geomi API key so Aptos RPC calls also get authenticated limits:
//
//    const aptosConfig = new AptosConfig({
//      network: Network.TESTNET,
//      clientConfig: { API_KEY: "aptoslabs_***" },
//    });
//    const aptosClient = new Aptos(aptosConfig);
// ---------------------------------------------------------------------------

function buildAptosClient() {
  if (!AptosConfig || !Aptos || !Network) return null;
  try {
    const aptosConfig = new AptosConfig({
      network     : resolveNetwork(),
      clientConfig: {
        API_KEY: SHELBY_API_KEY || undefined,
      },
    });
    return new Aptos(aptosConfig);
  } catch (err) {
    console.warn("[Shelby] Could not initialise Aptos client:", err.message);
    return null;
  }
}

const aptosClient = buildAptosClient();

// ---------------------------------------------------------------------------
//  UPLOAD
// ---------------------------------------------------------------------------

/**
 * Upload an encrypted buffer to Shelby via ShelbyNodeClient.
 * Auth is handled at client-construction time -- no per-request headers needed.
 *
 * @param {Buffer}  encryptedBuffer  AES-256-GCM encrypted file bytes
 * @param {string}  fileName         Original filename (metadata only)
 * @param {string}  mimeType         MIME type hint for Shelby metadata
 * @param {number}  expiresAt        Unix timestamp TTL hint for Shelby nodes
 * @returns {Promise<{cid: string, size: number, replicas: number}>}
 */
async function uploadToShelby(encryptedBuffer, fileName, mimeType, expiresAt) {
  const client   = getClient();
  const FormData = require("form-data");

  const form = new FormData();
  form.append("file", encryptedBuffer, {
    filename    : fileName,
    contentType : "application/octet-stream", // always opaque binary -- already encrypted
  });
  form.append("ttl",      expiresAt.toString());
  form.append("mimeHint", mimeType);

  try {
    const response = await client.upload(form, {
      erasureCoding : true, // distribute across nodes with erasure coding
      minReplicas   : 3,
      timeout       : SHELBY_TIMEOUT,
    });

    if (!response?.cid) throw new Error("Shelby response missing CID");

    return {
      cid      : response.cid,
      size     : response.size     || encryptedBuffer.length,
      replicas : response.replicas || 3,
    };
  } catch (err) {
    throw new ShelbyError(`Upload failed: ${err.message}`, err);
  }
}

// ---------------------------------------------------------------------------
//  DOWNLOAD
// ---------------------------------------------------------------------------

/**
 * Fetch an encrypted blob from Shelby by CID.
 * Falls back to SHELBY_REPLICA if the primary SDK call fails.
 *
 * @param {string} cid
 * @returns {Promise<Buffer>}
 */
async function downloadFromShelby(cid) {
  const client = getClient();

  try {
    const data = await client.download(cid, { timeout: SHELBY_TIMEOUT });
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  } catch (primaryErr) {
    if (SHELBY_REPLICA) {
      console.warn(`[Shelby] Primary download failed, trying replica: ${primaryErr.message}`);
      try {
        const axios = require("axios");
        const res = await axios.get(`${SHELBY_REPLICA}/blob/${encodeURIComponent(cid)}`, {
          responseType: "arraybuffer",
          timeout     : SHELBY_TIMEOUT,
          headers     : {
            // Replica may be a plain gateway; pass key via both common header formats
            "Authorization": SHELBY_API_KEY ? `Bearer ${SHELBY_API_KEY}` : undefined,
            "X-API-Key"    : SHELBY_API_KEY || undefined,
          },
        });
        return Buffer.from(res.data);
      } catch (replicaErr) {
        throw new ShelbyError(`Both gateways failed. Replica: ${replicaErr.message}`, replicaErr);
      }
    }
    throw new ShelbyError(`Download failed: ${primaryErr.message}`, primaryErr);
  }
}

// ---------------------------------------------------------------------------
//  DELETE  (early expiry signal)
// ---------------------------------------------------------------------------

/**
 * Signal Shelby nodes to delete a blob before its TTL expires.
 * Non-fatal -- Shelby's TTL garbage collection handles it regardless.
 *
 * @param {string} cid
 * @returns {Promise<boolean>}
 */
async function deleteFromShelby(cid) {
  try {
    await getClient().delete(cid);
    return true;
  } catch (err) {
    console.warn(`[Shelby] Early delete signal failed for ${cid}: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
//  HEALTH / STATUS
// ---------------------------------------------------------------------------

async function checkShelbyHealth() {
  try {
    const res = await getClient().health({ timeout: 5000 });
    return {
      healthy    : true,
      version    : res?.version,
      network    : SHELBY_NETWORK,
      keyPresent : Boolean(SHELBY_API_KEY),
      keyValid   : res?.authenticated ?? Boolean(SHELBY_API_KEY),
    };
  } catch (err) {
    return { healthy: false, error: err.message, keyPresent: Boolean(SHELBY_API_KEY) };
  }
}

async function getCIDStatus(cid) {
  try {
    return await getClient().status(cid);
  } catch (err) {
    return { available: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
//  MOCK MODE  (local dev -- no Shelby node or API key required)
//  Enable: SHELBY_MOCK=true in .env
// ---------------------------------------------------------------------------

const inMemoryStore = new Map();

const mockShelby = {
  upload: async (buf, fileName) => {
    const cid = "shelby://mock-" + crypto.randomBytes(16).toString("hex");
    inMemoryStore.set(cid, buf);
    console.log(`[MockShelby] Stored ${buf.length} bytes -> ${cid}`);
    return { cid, size: buf.length, replicas: 1 };
  },
  download: async (cid) => {
    const buf = inMemoryStore.get(cid);
    if (!buf) throw new Error(`Mock CID not found: ${cid}`);
    return buf;
  },
  delete : async (cid)  => { inMemoryStore.delete(cid); return true; },
  health : async ()     => ({ healthy: true, version: "mock", keyPresent: false, keyValid: false }),
  status : async (cid)  => ({ available: inMemoryStore.has(cid), replicas: 1 }),
};

// ---------------------------------------------------------------------------
//  ERROR CLASS
// ---------------------------------------------------------------------------

class ShelbyError extends Error {
  constructor(message, cause) {
    super(message);
    this.name  = "ShelbyError";
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
//  EXPORTS
// ---------------------------------------------------------------------------

const USE_MOCK = process.env.SHELBY_MOCK === "true" || !ShelbyNodeClient;

if (USE_MOCK && process.env.SHELBY_MOCK !== "true") {
  console.warn("[Shelby] SDK unavailable -- using mock mode.");
}

module.exports = {
  upload     : USE_MOCK ? mockShelby.upload   : uploadToShelby,
  download   : USE_MOCK ? mockShelby.download : downloadFromShelby,
  delete     : USE_MOCK ? mockShelby.delete   : deleteFromShelby,
  health     : USE_MOCK ? mockShelby.health   : checkShelbyHealth,
  status     : USE_MOCK ? mockShelby.status   : getCIDStatus,
  aptosClient,       // pre-configured Aptos client (null if SDK not installed)
  ShelbyError,
  isMockMode : USE_MOCK,
};
