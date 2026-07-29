import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { productEnv } from "./product";
import { STATE_DIRECTORY } from "./product-paths";

const stateDirectory = STATE_DIRECTORY;
const keyFile = path.join(stateDirectory, "master.key");

function encryptionKey() {
  const configured = productEnv("HYZR_CHAT_ENCRYPTION_KEY", "VMX_ENCRYPTION_KEY");
  if (configured) {
    const decoded = Buffer.from(configured, /^[a-f0-9]{64}$/i.test(configured) ? "hex" : "base64");
    if (decoded.length !== 32) throw new Error("HYZR_CHAT_ENCRYPTION_KEY must decode to exactly 32 bytes.");
    return decoded;
  }

  mkdirSync(stateDirectory, { recursive: true });
  if (!existsSync(keyFile)) {
    writeFileSync(keyFile, randomBytes(32), { flag: "wx" });
    try { chmodSync(keyFile, 0o600); } catch {}
  }
  const key = readFileSync(keyFile);
  if (key.length !== 32) throw new Error("The Hyzr Chat local encryption key is invalid.");
  return key;
}

export function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function unseal<T>(value: string): T {
  const packed = Buffer.from(value, "base64");
  if (packed[0] !== 1 || packed.length < 30) throw new Error("Unsupported encrypted Hyzr Chat payload.");
  const iv = packed.subarray(1, 13);
  const tag = packed.subarray(13, 29);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(packed.subarray(29)), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
