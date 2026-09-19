// ─── VAMPIRE RISE MD — All tunables in one place. No env vars. ───

export const PORT = 3000;

// Storage
export const STORAGE_DIR = './storage';

// Pairing session TTL (5 minutes)
export const PAIRING_TTL_MS = 5 * 60 * 1000;

// Rate limiting
export const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
export const RATE_LIMIT_MAX = 5;
export const GENERIC_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const GENERIC_RATE_LIMIT_MAX = 120;

// Delivery
export const SESSION_ID_DELAY_MS = 10_000; // exactly 10 seconds

// Logging
export const LOG_LEVEL = 'info';

// Branding
export const BRAND = {
  name: 'VAMPIRE RISE MD',
  developer: 'KENYAN JAGUAR',
};