// src/app.js
// ─────────────────────────────────────────────────────────────
// YoruSec Nox — Daemon Entry Point
// ─────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();

const express     = require('express');
const http        = require('http');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');

const logger       = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { authenticate } = require('./middleware/authenticate');
const { initSocket }   = require('./services/socketService');
const { startHeartbeat } = require('./services/heartbeat');
const { ensureDataDirs } = require('./utils/fs');

// ── Routes ────────────────────────────────────────────────────
const systemRoutes = require('./routes/system');
const botRoutes    = require('./routes/bots');

const app    = express();
const server = http.createServer(app);

// ── Middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));
}

// ── Auth (semua route kecuali /healthz) ──────────────────────
app.get('/healthz', (_req, res) => res.json({ status: 'ok', version: '1.0.0' }));
app.use(authenticate);

// ── API Routes ────────────────────────────────────────────────
app.use('/api', systemRoutes);
app.use('/api/bots', botRoutes);

// ── 404 ───────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// ── Error Handler ─────────────────────────────────────────────
app.use(errorHandler);

// ── Boot ──────────────────────────────────────────────────────
async function boot() {
  try {
    // Pastikan direktori data ada
    await ensureDataDirs();

    // Socket.io untuk console streaming ke panel (jika dibutuhkan)
    initSocket(server);

    // Mulai heartbeat ke panel setiap 30 detik
    startHeartbeat();

    const PORT = parseInt(process.env.NOX_PORT || '8080');
    const HOST = process.env.NOX_HOST || '0.0.0.0';

    server.listen(PORT, HOST, () => {
      logger.info(`Nox daemon listening on ${HOST}:${PORT}`);
      logger.info(`Panel URL: ${process.env.PANEL_URL}`);
    });
  } catch (err) {
    logger.error('Nox boot failed:', err);
    process.exit(1);
  }
}

boot();

module.exports = app;
