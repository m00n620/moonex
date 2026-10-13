import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;

export interface EncryptedData {
  ciphertext: string;
  salt: string;
  iv: string;
  authTag: string;
}

export function encryptPrivateKey(
  privateKey: string,
  password: string,
): EncryptedData {
  const salt = randomBytes(16);
  const iv = randomBytes(12);

  const key = scryptSync(password, salt, KEY_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("hex"),
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptPrivateKey(
  data: EncryptedData,
  password: string,
): string {
  const salt = Buffer.from(data.salt, "hex");
  const iv = Buffer.from(data.iv, "hex");
  const authTag = Buffer.from(data.authTag, "hex");
  const ciphertext = Buffer.from(data.ciphertext, "hex");

  const key = scryptSync(password, salt, KEY_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
