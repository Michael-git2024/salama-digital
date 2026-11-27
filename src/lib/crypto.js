import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM field encryption (used for MFA secrets at rest). Format: iv.tag.ciphertext (base64url)
export function encryptField(plain, hexKey) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}
export function decryptField(blob, hexKey) {
  const [iv, tag, ct] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
