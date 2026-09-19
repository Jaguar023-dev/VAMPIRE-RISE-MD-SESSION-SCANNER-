import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT } from './src/constants.js';
import { logger } from './src/logger.js';
import { createApiRouter } from './src/routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'], // QR data URLs
      styleSrc: ["'self'", "'unsafe-inline'"], // inline styles in HTML
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '64kb' }));

app.use('/api', createApiRouter());

// Serve frontend from the same origin — no CORS configuration needed.
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 for unknown API routes.
app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

// Central error handler — never leak stack traces to clients.
app.use((err, _req, res, _next) => {
  logger.error({ event: 'unhandled_error', message: err.message });
  if (!res.headersSent) res.status(500).json({ error: 'INTERNAL_ERROR' });
});

app.listen(PORT, () => {
  logger.info({ event: 'server_started', port: PORT });
});