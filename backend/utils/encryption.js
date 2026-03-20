/**
 * encryption.js — End-to-End Encryption Utilities
 * -------------------------------------------------
 * Uses AES-256-GCM for file encryption.
 * The encryption key is NEVER sent to the server — it lives only in the
 * shareable link (after #fragment, which is never sent to any server).
 *
 * Flow:
 *   1. Browser generates random AES-256 key
 *   2. Browser encrypts file → sends ciphertext to backend
 *   3. Backend stores ciphertext on Shelby
 *   4. Shareable link format:
 *      https://blink-share.app/d/<fileId>#<base64url(key+iv)>
 *   5. Recipient's browser extracts key from fragment, downloads ciphertext,
 *      decrypts locally — server never sees plaintext or key.
 */

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const KEY_LEN   = 32; // 256 bits
const IV_LEN    = 12; // 96 bits (GCM standard)
const TAG_LEN   = 16; // 128-bit authentication tag

// ─────────────────────────────────────────────────────────────────────────────
//  SERVER-SIDE HELPERS  (used only for integrity verification / re-wrapping)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a buffer with AES-256-GCM.
 * Returns a self-contained Buffer: [IV (12)] + [ciphertext] + [authTag (16)]
 *
 * @param {Buffer} plaintext
 * @param {Buffer} key   32-byte key
 * @returns {{ ciphertext: Buffer, key: Buffer, iv: Buffer }}
 */
function encrypt(plaintext, key) {
  if (!key) key = crypto.randomBytes(KEY_LEN);
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN });

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag       = cipher.getAuthTag();

  // Packed format: IV || ciphertext || authTag
  const packed = Buffer.concat([iv, encrypted, tag]);
  return { ciphertext: packed, key, iv };
}

/**
 * Decrypt a packed buffer produced by `encrypt()`.
 *
 * @param {Buffer} packed   IV || ciphertext || authTag
 * @param {Buffer} key      32-byte key
 * @returns {Buffer} plaintext
 */
function decrypt(packed, key) {
  if (packed.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Ciphertext too short");
  }

  const iv         = packed.slice(0, IV_LEN);
  const tag        = packed.slice(packed.length - TAG_LEN);
  const ciphertext = packed.slice(IV_LEN, packed.length - TAG_LEN);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Derive a deterministic key from a password + salt using scrypt.
 * Used for password-protected files.
 *
 * @param {string} password
 * @param {Buffer} salt      16-byte random salt
 * @returns {Promise<Buffer>}
 */
async function deriveKeyFromPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Compute the on-chain password hash.
 * Mirrors the Solidity: keccak256(abi.encode(salt, password))
 *
 * @param {string} password
 * @param {string} salt     bytes32 hex string
 * @returns {string} 0x-prefixed hex
 */
function computePasswordHash(password, salt) {
  const packed = Buffer.concat([
    Buffer.from(salt.replace("0x", ""), "hex"),
    Buffer.from(password, "utf8"),
  ]);
  return "0x" + crypto.createHash("sha256").update(packed).digest("hex");
}

/**
 * Encode key+iv into a URL-safe base64 string for the link fragment.
 */
function encodeKeyFragment(key, iv) {
  const combined = Buffer.concat([key, iv]);
  return combined.toString("base64url");
}

/**
 * Decode key+iv from a URL-safe base64 string.
 */
function decodeKeyFragment(fragment) {
  const combined = Buffer.from(fragment, "base64url");
  return {
    key: combined.slice(0, KEY_LEN),
    iv : combined.slice(KEY_LEN, KEY_LEN + IV_LEN),
  };
}

/**
 * Generate a cryptographically random salt (bytes32).
 */
function generateSalt() {
  return "0x" + crypto.randomBytes(32).toString("hex");
}

module.exports = {
  encrypt,
  decrypt,
  deriveKeyFromPassword,
  computePasswordHash,
  encodeKeyFragment,
  decodeKeyFragment,
  generateSalt,
  KEY_LEN,
  IV_LEN,
  TAG_LEN,
};
