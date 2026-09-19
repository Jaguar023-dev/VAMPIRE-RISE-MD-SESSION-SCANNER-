import rateLimit from 'express-rate-limit';
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  GENERIC_RATE_LIMIT_WINDOW_MS,
  GENERIC_RATE_LIMIT_MAX,
} from '../constants.js';

export const pairingLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many pairing attempts. Please try again later.' },
});

export const genericLimiter = rateLimit({
  windowMs: GENERIC_RATE_LIMIT_WINDOW_MS,
  max: GENERIC_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});