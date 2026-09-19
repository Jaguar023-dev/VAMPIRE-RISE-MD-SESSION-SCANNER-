import crypto from 'node:crypto';

/**
 * Public session identifier.
 * Format: VAMPIRE-<20 URL-safe base64 chars>
 * Entropy: 128 bits. Never contains the phone number.
 */
export function generateSessionId() {
  const randomPart = crypto
    .randomBytes(16)
    .toString('base64url')
    .slice(0, 20);
  return `VAMPIRE-${randomPart}`;
}

export function generateClientToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function isValidSessionIdFormat(id) {
  return typeof id === 'string' && /^VAMPIRE-[A-Za-z0-9_-]{20}$/.test(id);
}

export function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}