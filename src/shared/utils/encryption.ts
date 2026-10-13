import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;

export interface EncryptedData {
  ciphertext: string;
  salt: string;
  iv: string;
  authTag: string;
}

export function encryptPrivateKey(privateKey: string, password: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);

  const key = scryptSync(password, salt, KEY_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);

  const authTag = cipher.getAuthTag();

  return [iv.toString('hex'), authTag.toString('hex'), salt.toString('hex'), ciphertext.toString('hex')].join(':');
}

export function decryptPrivateKey(payload: string, password: string): string {
  const parts = payload.split(':') ?? [];

  if (
    parts.length !== 4 ||
    !parts.every((part) => /^[a-fA-F0-9]+$/.test(part)) ||
    parts[0]?.length !== 24 ||
    parts[1]?.length !== 32 ||
    parts[2]?.length !== 32 ||
    !parts[3]
  ) {
    throw new Error('Invalid encrypted secret format');
  }

  const [ivHex, tagHex, saltHex, ciphertextHex] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const salt = Buffer.from(saltHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const key = scryptSync(password, salt, KEY_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
