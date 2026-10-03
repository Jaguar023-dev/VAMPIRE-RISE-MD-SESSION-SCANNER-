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
 * BEFORE returning.
 *
 * CRITICAL: onReady fires ONLY on the `qr` event. The `connecting` event
 * is NOT a reliable readiness signal — it can fire before the Noise
 * handshake completes, causing WhatsApp to reject requestPairingCode()
 * with status 428 (Precondition Required).
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
    // Canonical browser label is REQUIRED for pairing code mode.
    // Non-canonical labels cause WhatsApp to reject companion_hello
    // with 400 bad-request, producing "dead" codes [citation:6].
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    logger: silentLogger(),
  });

  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
    } catch (err) {
      logger.error({ event: 'creds_persist_failed', message: err.message });
    }
  });

  let readyFired = false;
  let pairingCodeReturned = false;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // ─── ONLY trigger readiness on the qr event ───
    // Do NOT use 'connecting' as a fallback. It fires too early and
    // causes WhatsApp to close the socket with 428.
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

      if (statusCode === 428 && pairingCodeReturned) {
        logger.error({
          event: 'DEAD_CODE_DETECTED',
          message: 'WhatsApp rejected companion_hello. Wiping auth dir.',
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

  sock.__vampireMarkCodeReturned = () => { pairingCodeReturned = true; };

  liveSockets.set(appSessionId, { sock, authDir, createdAt: Date.now() });
  return { sock, authDir };
}

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