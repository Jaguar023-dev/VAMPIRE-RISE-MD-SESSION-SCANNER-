import QRCode from 'qrcode';
import { logger } from '../logger.js';

/**
 * Convert the raw QR string into a data URL for display.
 * Never persisted. Never logged.
 */
export async function qrToDataUrl(qrString) {
  try {
    const dataUrl = await QRCode.toDataURL(qrString, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#000000', light: '#ffffff' },
    });
    logger.info({ event: 'qr_generated' });
    return dataUrl;
  } catch (err) {
    logger.error({ event: 'qr_generation_failed', message: err.message });
    throw err;
  }
}