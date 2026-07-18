import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function key(): Buffer {
  const configured = process.env.SETTINGS_ENCRYPTION_KEY;
  if (configured) return crypto.createHash("sha256").update(configured).digest();

  const dataDir = process.env.DATA_DIR ?? path.resolve("data");
  const keyPath = path.join(dataDir, "settings.key");
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath);
  fs.mkdirSync(dataDir, { recursive: true });
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, generated, { mode: 0o600 });
  return generated;
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parts = value.split(".");
    if (parts.length !== 3) throw new Error("Ungültiges Secret-Format.");
    const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64url")) as [
      Buffer,
      Buffer,
      Buffer,
    ];
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    warnDecryptOnce();
    return undefined;
  }
}

let decryptWarningWritten = false;
function warnDecryptOnce() {
  if (decryptWarningWritten) return;
  decryptWarningWritten = true;
  console.warn(
    "[qa-council] Ein gespeichertes Secret konnte nicht entschlüsselt werden; Environment-Fallbacks bleiben aktiv.",
  );
}
