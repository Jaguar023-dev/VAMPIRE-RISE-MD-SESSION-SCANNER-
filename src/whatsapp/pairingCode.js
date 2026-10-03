import { logger } from '../logger.js';

export async function requestPairingCodeForSession(sock, normalizedPhone) {
  if (!normalizedPhone || !/^[0-9]{10,15}$/.test(normalizedPhone)) {
    throw new Error('INVALID_PHONE');
  }
  if (sock.authState.creds.registered) {
    throw new Error('ALREADY_REGISTERED');
  }

  try {
    const code = await sock.requestPairingCode(normalizedPhone);

    if (typeof sock.__vampireMarkCodeReturned === 'function') {
      sock.__vampireMarkCodeReturned();
    }

    logger.info({ event: 'pairing_code_generated' });
    return code;
  } catch (err) {
    logger.error({ event: 'pairing_code_failed', message: err.message });
    throw err;
  }
}