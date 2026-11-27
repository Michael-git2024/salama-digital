import { randomBytes } from 'node:crypto';
console.log(`JWT_SECRET=${randomBytes(48).toString('base64url')}`);
console.log(`MFA_ENC_KEY=${randomBytes(32).toString('hex')}`);
