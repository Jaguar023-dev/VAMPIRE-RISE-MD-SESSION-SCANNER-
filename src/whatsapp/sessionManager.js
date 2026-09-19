import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
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
 * Create a fresh Baileys socket for a new pairing attempt.
 */
export async function createSession(appSessionId) {
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