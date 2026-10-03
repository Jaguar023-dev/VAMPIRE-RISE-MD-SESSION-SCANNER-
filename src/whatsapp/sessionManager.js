import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import path from 'node:path';
import fs from 'node:fs/promises';
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
 * Wipe any stale auth state for a session directory.
 * Called before creating a new pairing socket so a previously failed
 * attempt cannot poison the next one (which causes dead pairing codes).
 */
async function resetAuthDir(authDir) {
  try {
    await fs.rm(authDir, { recursive: true, force: true });
  } catch (err) {
    logger.warn({ event: 'auth_dir_reset_failed', message: err.message });
  }
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
 *
 * Options:
 *   resetAuth  → if true, wipes the auth directory before creating the socket.
 *                Use true for a fresh pairing attempt.
 */
export async function createSession(appSessionId, callbacks = {}, options = {}) {
  const {
    onReady,
    onQR,
    onAuthenticated,
    onLoggedOut,
    onConnectionFailed,
    onRestartRequired,
  } = callbacks;

  const { resetAuth = false } = options;

  const authDir = path.join(STORAGE_DIR, 'auth', appSessionId);

  if (resetAuth) {
    await resetAuthDir(authDir);
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys),
    },
    // Do NOT set a custom browser label. Non-standard labels cause WhatsApp
    // to reject the companion_hello IQ, producing "dead" pairing codes.
    // Baileys auto-detects a compatible default when this is omitted.
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
  let pairingCodeReturned = false;

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

      // Dead-code detection: if WhatsApp closes the socket with 428
      // (Precondition Required) right after we returned a pairing code,
      // the code is not linkable. The browser label or phone number is
      // the usual culprit — wipe the auth dir so the next attempt is clean.
      if (statusCode === 428 && pairingCodeReturned) {
        logger.error({
          event: 'DEAD_CODE_DETECTED',
          message: 'WhatsApp rejected the companion_hello. Wiping auth dir.',
        });
        await resetAuthDir(authDir);
      }

      if (statusCode === DisconnectReason.loggedOut) {
        onLoggedOut?.();
      } else if (statusCode === DisconnectReason.restartRequired) {
        onRestartRequired?.();
      } else {
        onConnectionFailed?.({ statusCode, reason });
      }
    }
  });

  // Expose a hook so pairingCode.js can flag "code returned" on the socket
  // without importing private state.
  sock.__vampireMarkCodeReturned = () => { pairingCodeReturned = true; };

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