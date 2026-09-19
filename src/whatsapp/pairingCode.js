import { logger } from '../logger.js';

/**
 * Request a pairing code. MUST only be called after the socket is ready
 * (connection === 'connecting' or a QR event has fired).
 */
export async function requestPairingCodeForSession(sock, normalizedPhone) {
  if (!normalizedPhone || !/^[0-9]{10,15}$/.test(normalizedPhone)) {
    throw new Error('INVALID_PHONE');
  }
  if (sock.authState.creds.registered) {
    throw new Error('ALREADY_REGISTERED');
  }

  try {
    const code = await sock.requestPairingCode(normalizedPhone);
    logger.info({ event: 'pairing_code_generated' });
    return code;
  } catch (err) {
    logger.error({ event: 'pairing_code_failed', message: err.message });
    throw err;
  }
}