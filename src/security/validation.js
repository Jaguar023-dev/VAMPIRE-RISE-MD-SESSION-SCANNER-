/**
 * Strips +, spaces, brackets, hyphens. Returns digits only.
 * Requires a country code (no leading zero).
 */
export function normalizePhoneNumber(input) {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/[^0-9]/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.startsWith('0')) return null;
  return digits;
}

/**
 * Validates the app-issued UUID v4 session identifier.
 */
export function isValidAppSessionId(id) {
  return typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
}