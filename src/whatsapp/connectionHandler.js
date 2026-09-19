import { DisconnectReason } from '@whiskeysockets/baileys';
import { logger } from '../logger.js';

/**
 * Attaches Baileys connection listeners and delegates state changes.
 * The ONLY place that decides when a pairing truly succeeded.
 */
export function attachConnectionHandler(sock, callbacks) {
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && callbacks.onQR) {
      await callbacks.onQR(qr);
    }

    if (connection === 'connecting' && callbacks.onConnecting) {
      callbacks.onConnecting();
    }

    if (connection === 'open' && callbacks.onAuthenticated) {
      logger.info({ event: 'whatsapp_authenticated' });
      await callbacks.onAuthenticated();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || 'unknown';

      logger.warn({ event: 'connection_closed', statusCode });

      if (statusCode === DisconnectReason.loggedOut) {
        callbacks.onLoggedOut?.();
      } else if (statusCode === DisconnectReason.restartRequired) {
        // Required for QR flow after a successful scan.
        callbacks.onRestartRequired?.();
      } else {
        callbacks.onConnectionFailed?.({ statusCode, reason });
      }
    }
  });
}