'use strict';

(() => {
  const $ = (sel) => document.querySelector(sel);

  const screens = {
    home:    $('#screen-home'),
    phone:   $('#screen-phone'),
    code:    $('#screen-code'),
    qr:      $('#screen-qr'),
    success: $('#screen-success'),
    error:   $('#screen-error'),
  };

  let currentSession = null;   // { sessionId, clientToken }
  let eventSource = null;
  let currentMode = null;      // 'phone' | 'qr'

  function show(name) {
    for (const key of Object.keys(screens)) {
      screens[key].classList.toggle('hidden', key !== name);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showError(message) {
    $('#error-message').textContent = message;
    show('error');
  }

  function resetState() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    currentSession = null;
    currentMode = null;
    $('#pairing-code').textContent = '------';
    $('#copy-status').textContent = '';
    $('#qr-image').classList.remove('visible');
    $('#qr-placeholder').style.display = 'flex';
    $('#phone-input').value = '';
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || 'Request failed');
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function createSession() {
    const data = await api('/api/session/create', { method: 'POST' });
    currentSession = { sessionId: data.sessionId, clientToken: data.clientToken };
    return currentSession;
  }

  function openEventStream() {
    if (!currentSession) return;
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/session/${currentSession.sessionId}/events`);
    eventSource.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        handleEvent(payload);
      } catch { /* ignore */ }
    };
    eventSource.onerror = () => { /* SSE will reconnect automatically */ };
  }

  function handleEvent(evt) {
    switch (evt.type) {
      case 'QR_READY':
        renderQR(evt.qr);
        break;
      case 'CONNECTED':
      case 'SESSION_GENERATING':
      case 'SESSION_READY':
        show('success');
        break;
      case 'ERROR':
        showError(friendlyError(evt.code));
        break;
      default:
        break;
    }
  }

  function renderQR(dataUrl) {
    const img = $('#qr-image');
    img.src = dataUrl;
    img.classList.add('visible');
    $('#qr-placeholder').style.display = 'none';
  }

  function friendlyError(code) {
    switch (code) {
      case 'LOGGED_OUT':         return '❌ This WhatsApp session was logged out. Please generate a new one.';
      case 'CONNECTION_FAILED':  return '❌ WhatsApp connection failed. Please try again.';
      case 'PAIRING_EXPIRED':    return '⏱️ This pairing session has expired. Please generate a new one.';
      case 'TIMEOUT':            return '⏱️ Pairing timed out. Please generate a new one.';
      case 'AUTHENTICATION_FAILED': return '❌ Authentication failed. Please try again.';
      case 'DELIVERY_FAILED':    return '❌ Session connected but delivery failed. Please try again.';
      default:                   return '❌ Something went wrong. Please try again.';
    }
  }

  // ─── Navigation ───
  $('#btn-phone').addEventListener('click', () => {
    resetState();
    show('phone');
  });

  $('#btn-qr').addEventListener('click', async () => {
    resetState();
    currentMode = 'qr';
    show('qr');
    try {
      await createSession();
      await api(`/api/session/${currentSession.sessionId}/qr`, { method: 'GET' });
      openEventStream();
    } catch (err) {
      showError(err.message || 'Failed to start QR pairing.');
    }
  });

  $('#btn-phone-submit').addEventListener('click', submitPhone);
  $('#phone-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPhone();
  });

  async function submitPhone() {
    const raw = $('#phone-input').value.trim();
    if (!raw) {
      showError('❌ Please enter a valid WhatsApp number including the country code.');
      return;
    }
    currentMode = 'phone';
    try {
      if (!currentSession) await createSession();
      const res = await api(`/api/session/${currentSession.sessionId}/pair-phone`, {
        method: 'POST',
        body: JSON.stringify({
          phoneNumber: raw,
          clientToken: currentSession.clientToken,
        }),
      });
      $('#pairing-code').textContent = res.pairingCode || '------';
      show('code');
      openEventStream();
    } catch (err) {
      if (err.code === 'INVALID_PHONE') {
        showError('❌ Please enter a valid WhatsApp number including the country code.');
      } else if (err.code === 'RATE_LIMITED') {
        showError('⏱️ Too many attempts. Please wait a few minutes and try again.');
      } else {
        showError(err.message || 'Failed to generate pairing code.');
      }
    }
  }

  // ─── Copy code ───
  $('#btn-copy-code').addEventListener('click', async () => {
    const code = $('#pairing-code').textContent.trim();
    if (!code || code === '------') return;
    try {
      await navigator.clipboard.writeText(code);
      $('#copy-status').textContent = 'Copied!';
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); $('#copy-status').textContent = 'Copied!'; }
      catch { $('#copy-status').textContent = 'Copy failed — please copy manually.'; }
      document.body.removeChild(ta);
    }
    setTimeout(() => { $('#copy-status').textContent = ''; }, 2000);
  });

  // ─── Refresh QR ───
  $('#btn-refresh-qr').addEventListener('click', async () => {
    if (!currentSession) return;
    $('#qr-image').classList.remove('visible');
    $('#qr-placeholder').style.display = 'flex';
    try {
      await api(`/api/session/${currentSession.sessionId}/qr`, { method: 'GET' });
      openEventStream();
    } catch (err) {
      showError(err.message || 'Failed to refresh QR.');
    }
  });

  // ─── Back buttons ───
  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      resetState();
      show('home');
    });
  });

  $('#btn-error-back').addEventListener('click', () => {
    resetState();
    show('home');
  });

  // ─── Cleanup on unload ───
  window.addEventListener('beforeunload', () => {
    if (eventSource) eventSource.close();
  });
})();