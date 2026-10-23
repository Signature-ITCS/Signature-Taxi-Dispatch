import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Encryption for API keys and passwords stored in the database (`secrets`).
 *
 * AES-256-GCM with a 32-byte key from SECRETS_ENCRYPTION_KEY (base64), which
 * lives only in the server environment (Vercel). A copy of the database alone —
 * a backup, a leaked dump — therefore reveals no keys. Server-only.
 *
 * Format: "v1:<iv>:<tag>:<ciphertext>", each part base64.
 */
/** The variable as pasted, forgiving quotes or a "SECRETS_ENCRYPTION_KEY=" prefix left in. */
function rawKey(): string {
  return (process.env.SECRETS_ENCRYPTION_KEY ?? "")
    .trim()
    .replace(/^SECRETS_ENCRYPTION_KEY\s*=\s*/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function encryptionKey(): Buffer {
  const raw = rawKey();
  if (!raw) throw new Error("SECRETS_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("SECRETS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptionConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * What is wrong with the encryption key, in words safe to show the platform
 * owner (lengths only — never the value). Null when it is fine.
 */
export function encryptionProblem(): string | null {
  const raw = rawKey();
  if (!raw) return "SECRETS_ENCRYPTION_KEY is not set on this deployment. Add it in Vercel → Settings → Environment Variables (tick Production), then redeploy.";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    return `SECRETS_ENCRYPTION_KEY is set (${raw.length} characters) but contains characters that aren't part of the key — re-copy only the value (44 characters, usually ending in "="), with no spaces.`;
  }
  const bytes = Buffer.from(raw, "base64").length;
  if (bytes !== 32) {
    return `SECRETS_ENCRYPTION_KEY is set but has ${raw.length} characters (it should have 44). Re-copy the whole value, then redeploy.`;
  }
  return null;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}
