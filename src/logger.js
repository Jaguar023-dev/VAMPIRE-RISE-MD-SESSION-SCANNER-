import pino from 'pino';
import { LOG_LEVEL } from './constants.js';

export const logger = pino({
  level: LOG_LEVEL,
  redact: {
    paths: [
      'password', 'secret', 'token', 'creds', 'keys',
      'phoneNumber', 'normalizedPhone', 'pairingCode',
      'sessionId', 'appSessionId', 'publicSessionId',
      '*.creds', '*.keys', '*.pairingCode', '*.sessionId',
    ],
    censor: '[REDACTED]',
  },
  base: { app: 'vampire-rise-md' },
  timestamp: pino.stdTimeFunctions.isoTime,
});