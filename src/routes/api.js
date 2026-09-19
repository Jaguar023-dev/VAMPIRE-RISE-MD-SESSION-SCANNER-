import express from 'express';
import crypto from 'node:crypto';
import { SessionStore } from '../storage/SessionStore.js';
import { FilesystemAdapter } from '../storage/FilesystemAdapter.js';
import { STORAGE_DIR, SESSION_ID_DELAY_MS } from '../constants.js';
import { logger } from '../logger.js';
import { generateSessionId, generateClientToken } from '../security/sessionSecurity.js';
import { normalizePhoneNumber, isValidAppSessionId } from '../security/validation.js';
import { requestPairingCodeForSession } from '../whatsapp/pairingCode.js';
import { qrToDataUrl } from '../whatsapp/qrHandler.js';
import { createSession, getLiveSocket, removeLiveSocket } from '../whatsapp/sessionManager.js';
import { buildFirstMessage, buildSessionIdMessage } from '../whatsapp/messages.js';
import { pairingLimiter, genericLimiter } from '../security/rateLimit.js';

export function createApiRouter() {
  const router = express.Router();
  const store = new SessionStore(new FilesystemAdapter(STORAGE_DIR));

  router.use(genericLimiter);

  // ─── POST /api/session/create ───
  router.post('/session/create', async (req, res) => {
    try {
      const appSessionId = crypto.randomUUID();
      const clientToken = generateClientToken();
      await store.create(appSessionId, { clientToken, ip: req.ip });
      res.json({ sessionId: appSessionId, clientToken, status: 'IDLE' });
    } catch (err) {
      logger.error({ event: 'session_create_failed', message: err.message });
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // ─── POST /api/session/:id/pair-phone ───
  // The pairing code is requested ONLY after the socket is ready.
  // Readiness is signalled via the onReady callback inside createSession().
  router.post('/session/:id/pair-phone', pairingLimiter, async (req, res) => {
    const { id } = req.params;
    const { phoneNumber, clientToken } = req.body || {};

    if (!isValidAppSessionId(id)) {
      return res.status(400).json({ error: 'INVALID_SESSION_ID' });
    }
    const session = await store.get(id);
    if (!session) return res.status(410).json({ error: 'SESSION_EXPIRED' });
    if (session.status === 'AUTHENTICATED' || session.status === 'SESSION_READY') {
      return res.status(409).json({ error: 'ALREADY_CONNECTED' });
    }
    if (clientToken && clientToken !== session.clientToken) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) {
      return res.status(400).json({
        error: 'INVALID_PHONE',
        message: 'Please enter a valid WhatsApp number including the country code.',
      });
    }

    try {
      await store.update(id, { status: 'INITIALIZING' });

      let responded = false;
      let pendingSock = null;

      const { sock } = await createSession(id, {
        // Fires exactly once when the socket can accept a pairing code.
        onReady: async () => {
          try {
            const code = await requestPairingCodeForSession(sock, normalized);
            await store.update(id, { status: 'PAIRING' });
            if (!responded) {
              responded = true;
              res.json({ pairingCode: code, status: 'PAIRING' });
            }
          } catch (err) {
            logger.error({ event: 'pairing_code_failed', message: err.message });
            await store.update(id, { status: 'CONNECTION_FAILED' });
            if (!responded) {
              responded = true;
              res.status(500).json({ error: 'PAIRING_CODE_FAILED' });
            }
          }
        },
        onAuthenticated: () => runDeliveryFlow(id, store, sock),
        onLoggedOut: () => store.update(id, { status: 'LOGGED_OUT' }),
        onConnectionFailed: () => store.update(id, { status: 'CONNECTION_FAILED' }),
        onRestartRequired: () => { /* Baileys auto-reconnects */ },
      });

      pendingSock = sock;

      // Safety timeout — if the socket never becomes ready, fail cleanly.
      setTimeout(async () => {
        if (responded) return;
        responded = true;
        const s = await store.get(id);
        if (s && s.status === 'INITIALIZING') {
          await store.update(id, { status: 'TIMEOUT' });
          if (!res.headersSent) {
            res.status(504).json({ error: 'TIMEOUT' });
          }
        }
      }, 30_000);

      // Keep a reference to prevent unused-var lint complaints in strict setups.
      void pendingSock;
    } catch (err) {
      logger.error({ event: 'pair_phone_failed', message: err.message });
      await store.update(id, { status: 'CONNECTION_FAILED' });
      if (!res.headersSent) res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // ─── GET /api/session/:id/qr ───
  router.get('/session/:id/qr', pairingLimiter, async (req, res) => {
    const { id } = req.params;
    if (!isValidAppSessionId(id)) {
      return res.status(400).json({ error: 'INVALID_SESSION_ID' });
    }
    const session = await store.get(id);
    if (!session) return res.status(410).json({ error: 'SESSION_EXPIRED' });
    if (session.status === 'AUTHENTICATED' || session.status === 'SESSION_READY') {
      return res.status(409).json({ error: 'ALREADY_CONNECTED' });
    }

    try {
      await store.update(id, { status: 'INITIALIZING' });

      const { sock } = await createSession(id, {
        onQR: async (qr) => {
          const dataUrl = await qrToDataUrl(qr);
          await store.update(id, { status: 'WAITING_FOR_PAIRING' });
          publishToSession(id, { type: 'QR_READY', qr: dataUrl });
        },
        onAuthenticated: () => runDeliveryFlow(id, store, sock),
        onLoggedOut: () => {
          store.update(id, { status: 'LOGGED_OUT' });
          publishToSession(id, { type: 'ERROR', code: 'LOGGED_OUT' });
        },
        onConnectionFailed: () => {
          store.update(id, { status: 'CONNECTION_FAILED' });
          publishToSession(id, { type: 'ERROR', code: 'CONNECTION_FAILED' });
        },
        onRestartRequired: () => { /* Baileys auto-reconnects */ },
      });

      res.json({ status: 'INITIALIZING' });
    } catch (err) {
      logger.error({ event: 'qr_start_failed', message: err.message });
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // ─── GET /api/session/:id/status ───
  router.get('/session/:id/status', async (req, res) => {
    const { id } = req.params;
    if (!isValidAppSessionId(id)) {
      return res.status(400).json({ error: 'INVALID_SESSION_ID' });
    }
    const session = await store.get(id);
    if (!session) return res.status(410).json({ error: 'SESSION_EXPIRED' });
    res.json({
      status: session.status,
      connected: session.status === 'AUTHENTICATED' || session.status === 'SESSION_READY',
    });
  });

  // ─── GET /api/session/:id/events (SSE) ───
  router.get('/session/:id/events', (req, res) => {
    const { id } = req.params;
    if (!isValidAppSessionId(id)) {
      return res.status(400).json({ error: 'INVALID_SESSION_ID' });
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const subscriber = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    subscribeToSession(id, subscriber);

    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribeFromSession(id, subscriber);
    });
  });

  // ─── DELETE /api/session/:id ───
  router.delete('/session/:id', async (req, res) => {
    const { id } = req.params;
    const { clientToken } = req.body || {};
    if (!isValidAppSessionId(id)) {
      return res.status(400).json({ error: 'INVALID_SESSION_ID' });
    }
    const session = await store.get(id);
    if (!session) return res.status(410).json({ error: 'SESSION_EXPIRED' });
    if (clientToken && clientToken !== session.clientToken) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const entry = getLiveSocket(id);
    if (entry?.sock) {
      try { await entry.sock.logout(); } catch { /* ignore */ }
    }
    removeLiveSocket(id);
    await store.delete(id);
    res.json({ ok: true });
  });

  return router;
}

// ─── In-process event bus ───
const subscribers = new Map();

function subscribeToSession(appSessionId, fn) {
  if (!subscribers.has(appSessionId)) subscribers.set(appSessionId, new Set());
  subscribers.get(appSessionId).add(fn);
}
function unsubscribeFromSession(appSessionId, fn) {
  subscribers.get(appSessionId)?.delete(fn);
}
function publishToSession(appSessionId, event) {
  const subs = subscribers.get(appSessionId);
  if (!subs) return;
  for (const fn of subs) {
    try { fn(event); } catch { /* ignore */ }
  }
}

/**
 * Delivery flow:
 *   1. Generate session ID
 *   2. Send first (banner) message
 *   3. Wait 10s server-side
 *   4. Reply to the first message with ONLY the session ID
 */
async function runDeliveryFlow(appSessionId, store, sock) {
  try {
    await store.update(appSessionId, { status: 'AUTHENTICATED' });
    publishToSession(appSessionId, { type: 'CONNECTED' });

    const me = sock.user;
    if (!me?.id) {
      logger.error({ event: 'no_user_jid_after_auth' });
      return;
    }
    // Strip device suffix: "254...:12@s.whatsapp.net" → "254...@s.whatsapp.net"
    const userJid = me.id.replace(/:\d+/, '');

    await store.update(appSessionId, { status: 'GENERATING_SESSION' });
    publishToSession(appSessionId, { type: 'SESSION_GENERATING' });

    const publicSessionId = generateSessionId();

    // 1. Send the banner message.
    const firstSent = await sock.sendMessage(userJid, { text: buildFirstMessage() });
    logger.info({ event: 'session_message_sent' });

    // 2. Server-side 10-second delay. Never trust a browser timer here.
    await new Promise((resolve) => setTimeout(resolve, SESSION_ID_DELAY_MS));

    // 3. Send the session ID alone, as a quoted reply.
    await sock.sendMessage(
      userJid,
      { text: buildSessionIdMessage(publicSessionId) },
      { quoted: firstSent }
    );
    logger.info({ event: 'session_delivery_completed' });

    await store.update(appSessionId, {
      status: 'SESSION_READY',
      publicSessionId,
      deliveredAt: Date.now(),
    });
    publishToSession(appSessionId, { type: 'SESSION_READY' });
  } catch (err) {
    logger.error({ event: 'delivery_flow_failed', message: err.message });
    await store.update(appSessionId, { status: 'CONNECTION_FAILED' });
    publishToSession(appSessionId, { type: 'ERROR', code: 'DELIVERY_FAILED' });
  }
}