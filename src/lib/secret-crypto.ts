import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

/**
 * Server-side sealing of a site's Vercel "Protection Bypass for Automation"
 * secret (adapted from the webhooks app's edge secret-crypto).
 *
 * The plaintext only exists here: when an admin types it in the site setup
 * (sealed by `/api/vercel-secret`) and inside `/api/test` while the request
 * is made. What is stored in the content tree and held by the browser is
 * AES-256-GCM ciphertext that only opens with the deployment's key.
 *
 * A seal is bound (GCM additional authenticated data) to:
 * - the caller's Sitecore Cloud organization, so a copied value is useless to
 *   another organization;
 * - the site's hosts, so `/api/test` only ever sends the secret to those
 *   hosts. Without this any signed-in user able to read the settings item
 *   could point a test at their own server and read the secret off the
 *   request. Changing the list of hosts breaks the seal, so it cannot be
 *   widened without re-entering the secret.
 *
 * The key comes from SECRET_ENCRYPTION_KEY (a passphrase of 16+ characters; a
 * 32-byte key is derived with HKDF-SHA256). There is no plaintext fallback.
 */

const KEY_ENV = "SECRET_ENCRYPTION_KEY";
const MIN_KEY_LENGTH = 16;

const SEAL_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
// Keeps the app's former name on purpose: changing the salt changes the key,
// and every saved Vercel secret would stop opening.
const HKDF_SALT = "sitecoreai-marketplace-redirects-manager";
const HKDF_INFO = "vercel-protection-bypass";

/** The deployment has no (usable) SECRET_ENCRYPTION_KEY. */
export class EncryptionUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "EncryptionUnavailableError";
  }
}

/** A sealed secret could not be opened: malformed, tampered with, another key, organization or host list. */
export class SecretSealError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "SecretSealError";
  }
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const passphrase = process.env[KEY_ENV]?.trim();
  if (!passphrase) {
    throw new EncryptionUnavailableError(
      `${KEY_ENV} is not set on the server, so the Vercel secret cannot be stored.`,
    );
  }
  if (passphrase.length < MIN_KEY_LENGTH) {
    throw new EncryptionUnavailableError(
      `${KEY_ENV} must be at least ${MIN_KEY_LENGTH} characters.`,
    );
  }

  cachedKey = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(passphrase, "utf8"),
      Buffer.from(HKDF_SALT, "utf8"),
      Buffer.from(HKDF_INFO, "utf8"),
      KEY_BYTES,
    ),
  );
  return cachedKey;
}

/** Who a sealed secret belongs to and where it may be sent. */
export interface SecretBinding {
  /** Verified org_id claim of the caller's Sitecore Cloud access token. */
  organizationId: string;
  /** Lower-case host names the secret may be sent to. */
  hosts: string[];
}

function bindingData({ organizationId, hosts }: SecretBinding): Buffer {
  // Sorted and de-duplicated so the same set always gives the same AAD.
  const normalized = [...new Set(hosts.map((host) => host.toLowerCase()))].sort();
  return Buffer.from(
    JSON.stringify(["org", organizationId, "hosts", normalized]),
    "utf8",
  );
}

export function sealSecret(plaintext: string, binding: SecretBinding): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  cipher.setAAD(bindingData(binding));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    SEAL_VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function openSecret(sealed: string, binding: SecretBinding): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== SEAL_VERSION) {
    throw new SecretSealError(
      "The saved Vercel bypass secret is unreadable. Enter it again in the site's Vercel settings.",
    );
  }
  const [, iv, tag, ciphertext] = parts;
  try {
    const ivBytes = Buffer.from(iv, "base64url");
    const tagBytes = Buffer.from(tag, "base64url");
    // Full-length IV and tag only: Node accepts truncated GCM tags otherwise,
    // which would weaken the authenticity check.
    if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) {
      throw new Error("Malformed seal");
    }
    const decipher = createDecipheriv("aes-256-gcm", getKey(), ivBytes, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(bindingData(binding));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof EncryptionUnavailableError) throw error;
    throw new SecretSealError(
      "The saved Vercel bypass secret could not be decrypted (another encryption key or organization, or the site's hosts changed). Enter it again in the site's Vercel settings.",
    );
  }
}
