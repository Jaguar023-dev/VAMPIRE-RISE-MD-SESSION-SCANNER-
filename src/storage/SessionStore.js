import { PAIRING_TTL_MS } from '../constants.js';

/**
 * SessionStore abstraction. Adapter is swappable without touching
 * WhatsApp pairing logic.
 */
export class SessionStore {
  constructor(adapter) {
    this.adapter = adapter;
  }

  async create(sessionId, metadata = {}) {
    const record = {
      sessionId,
      status: 'IDLE',
      createdAt: Date.now(),
      expiresAt: Date.now() + PAIRING_TTL_MS,
      ...metadata,
    };
    await this.adapter.set(`session_${sessionId}`, record);
    return record;
  }

  async get(sessionId) {
    const record = await this.adapter.get(`session_${sessionId}`);
    if (!record) return null;
    const terminal = record.status === 'SESSION_READY' || record.status === 'AUTHENTICATED';
    if (!terminal && record.expiresAt && record.expiresAt < Date.now()) {
      await this.delete(sessionId);
      return null;
    }
    return record;
  }

  async update(sessionId, patch) {
    const existing = await this.get(sessionId);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: Date.now() };
    await this.adapter.set(`session_${sessionId}`, updated);
    return updated;
  }

  async delete(sessionId) {
    await this.adapter.del(`session_${sessionId}`);
    await this.adapter.del(`creds_${sessionId}`);
  }

  async saveCredentials(sessionId, creds) {
    await this.adapter.set(`creds_${sessionId}`, creds);
  }

  async loadCredentials(sessionId) {
    return this.adapter.get(`creds_${sessionId}`);
  }
}