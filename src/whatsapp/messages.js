export const BRAND_FOOTER = `🦇 VAMPIRE RISE MD
⚔️ KENYAN JAGUAR

«ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴠᴀᴍᴘɪʀᴇ ʀɪꜱᴇ ᴍᴅ»`;

/**
 * First message — sent immediately after authentication.
 */
export function buildFirstMessage() {
  return `╭━━━〔 🩸 VAMPIRE RISE MD 〕━━━╮
┃
┃ 🔐 SESSION ID GENERATOR
┃
┃ Your WhatsApp session is ready
┃ to be initialized.
┃
┃ 🩸 Preparing secure session...
┃
┃ ━━━━━━━━━━━━━━━━━━━━━
┃
┃ 📱 Step 1: Session initialized
┃ 🔗 Step 2: Establishing connection
┃ 🔐 Step 3: Generating credentials
┃
┃ ⏳ Please wait while your
┃ secure Session ID is generated.
┃
┃ ⚠️ SECURITY WARNING
┃
┃ 🔒 Never share your Session ID
┃ with anyone.
┃
┃ 🚫 Anyone with access to your
┃ session credentials may be able
┃ to access your WhatsApp account.
┃
┃ ⚠️ Do not close this chat or
┃ send another request.
┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯

${BRAND_FOOTER}

⏳ Connected successfully!

Your session ID will be ready in a few moments — please wait, do not close WhatsApp.`;
}

/**
 * Second message — the raw session ID, sent alone as a reply to the first.
 * No decoration, no ASCII box, no footer.
 */
export function buildSessionIdMessage(sessionId) {
  return sessionId;
}