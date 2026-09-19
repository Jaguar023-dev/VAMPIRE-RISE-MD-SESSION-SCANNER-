import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import path from 'node:path';
import { STORAGE_DIR } from '../constants.js';
import { logger } from '../logger.js';

const liveSockets = new Map();

export function getLiveSocket(appSessionId) {
  return liveSockets.get(appSessionId) || null;
}

export function removeLiveSocket(appSessionId) {
  const entry = liveSockets.get(appSessionId);
  if (entry?.sock) {
    try { entry.sock.end(undefined); } catch { /* ignore */ }
  }
  liveSockets.delete(appSessionId);
}

/**
 * Create a fresh Baileys socket and attach ALL connection handlers
 * BEFORE returning. This guarantees we never miss the first readiness
 * event (the `qr` event), which is what requestPairingCode() depends on.
 *
 * Callbacks:
 *   onReady            → fired exactly once, when the socket can accept
 *                        requestPairingCode(). Triggered by the first `qr`
 *                        event, with a fallback on `connection === 'connecting'`.
 *   onQR(qr)           → fired for every fresh QR string (QR mode).
 *   onAuthenticated    → fired when WhatsApp confirms `connection === 'open'`.
 *   onLoggedOut        → fired on DisconnectReason.loggedOut.
 *   onConnectionFailed → fired on any other close reason.
 *   onRestartRequired  → fired on DisconnectReason.restartRequired.
 */
export async function createSession(appSessionId, callbacks = {}) {
  const {
    onReady,
    onQR,
    onAuthenticated,
    onLoggedOut,
    onConnectionFailed,
    onRestartRequired,
  } = callbacks;

  const authDir = path.join(STORAGE_DIR, 'auth', appSessionId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys),
    },
    // Canonical browser label — custom labels produce dead pairing codes.
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    logger: silentLogger(),
  });

  // Persist credentials on every update. Critical for restart recovery.
  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
    } catch (err) {
      logger.error({ event: 'creds_persist_failed', message: err.message });
    }
  });

  // ─── Attach connection handler BEFORE returning ───
  // The very first event can fire synchronously during makeWASocket().
  // Attaching here ensures we never miss it.
  let readyFired = false;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // The `qr` event is the reliable readiness signal for BOTH modes:
    //   - QR mode: we forward it to the browser.
    //   - Pairing-code mode: it tells us the socket is ready for
    //     requestPairingCode(). Calling too early causes "Connection Closed".
    if (qr) {
      if (onQR) {
        try { await onQR(qr); } catch (err) {
          logger.error({ event: 'onQR_failed', message: err.message });
        }
      }
      if (!readyFired) {
        readyFired = true;
        if (onReady) {
          try { await onReady(); } catch (err) {
            logger.error({ event: 'onReady_failed', message: err.message });
          }
        }
      }
      return;
    }

    // Fallback: some builds emit 'connecting' without a prior qr.
    if (connection === 'connecting' && !readyFired) {
      readyFired = true;
      if (onReady) {
        try { await onReady(); } catch (err) {
          logger.error({ event: 'onReady_failed', message: err.message });
        }
      }
    }

    if (connection === 'open' && onAuthenticated) {
      logger.info({ event: 'whatsapp_authenticated' });
      try { await onAuthenticated(); } catch (err) {
        logger.error({ event: 'onAuthenticated_failed', message: err.message });
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || 'unknown';
      logger.warn({ event: 'connection_closed', statusCode });

      if (statusCode === DisconnectReason.loggedOut) {
        onLoggedOut?.();
      } else if (statusCode === DisconnectReason.restartRequired) {
        onRestartRequired?.();
      } else {
        onConnectionFailed?.({ statusCode, reason });
      }
    }
  });

  liveSockets.set(appSessionId, { sock, authDir, createdAt: Date.now() });
  return { sock, authDir };
}

/**
 * Restore an already-paired session from disk after a server restart.
 */
export async function restoreSession(appSessionId) {
  const authDir = path.join(STORAGE_DIR, 'auth', appSessionId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  if (!state.creds?.registered) return null;

  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys),
    },
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    syncFullHistory: false,
    logger: silentLogger(),
  });

  sock.ev.on('creds.update', saveCreds);
  liveSockets.set(appSessionId, { sock, authDir, createdAt: Date.now(), restored: true });
  return sock;
}

function silentLogger() {
  return {
    level: 'silent',
    fatal: () => {}, error: () => {}, warn: () => {},
    info: () => {}, debug: () => {}, trace: () => {},
    child: () => silentLogger(),
  };
}