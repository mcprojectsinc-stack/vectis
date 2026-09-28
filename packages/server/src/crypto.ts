import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from './config';

// Encrypt sensitive values (e.g. AI provider keys) at rest with AES-256-GCM.
// The key is derived from VECTIS_ENC_KEY if set, otherwise the JWT secret, so no
// new required config. Stored format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
const SECRET = process.env.VECTIS_ENC_KEY || config.jwtSecret || 'vectis-fallback-key';
const KEY = scryptSync(SECRET, 'vectis.enc.v1', 32);
const PREFIX = 'v1:';

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext — migrate on next write
  try {
    const [, ivB, tagB, ctB] = stored.split(':');
    const d = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB, 'base64'));
    d.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ctB, 'base64')), d.final()]).toString('utf8');
  } catch {
    return ''; // key changed / corrupt — treat as unset
  }
}

export function isEncrypted(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}
