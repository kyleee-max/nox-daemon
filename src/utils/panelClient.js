// src/utils/panelClient.js
// ─────────────────────────────────────────────────────────────
// Nox → Panel HTTP callbacks
// Semua request ke panel menggunakan:
//   Authorization: Bearer <token_id>:<raw_token>
// ─────────────────────────────────────────────────────────────
'use strict';

const https  = require('https');
const http   = require('http');
const logger = require('./logger');

const PANEL_URL  = () => process.env.PANEL_URL || '';
const TOKEN_ID   = () => process.env.NOX_TOKEN_ID || '';
const TOKEN      = () => process.env.NOX_TOKEN || '';
const TIMEOUT_MS = parseInt(process.env.PANEL_TIMEOUT_MS || '5000');

async function post(path, body = {}) {
  return request('POST', path, body);
}

async function get(path) {
  return request('GET', path, null);
}

async function request(method, path, body) {
  const base    = PANEL_URL();
  if (!base) {
    logger.warn('PANEL_URL not configured, skipping callback.');
    return null;
  }

  const url     = new URL(path, base);
  const bodyStr = body ? JSON.stringify(body) : null;
  const auth    = `Bearer ${TOKEN_ID()}:${TOKEN()}`;

  const headers = {
    'Authorization': auth,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };
  if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();

  return new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers,
      timeout:  TIMEOUT_MS,
      rejectUnauthorized: false, // Panel bisa self-signed
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });

    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', (err) => {
      logger.warn(`Panel callback failed [${method} ${path}]: ${err.message}`);
      resolve(null);
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Convenience callbacks ──────────────────────────────────────

/** Kirim status bot ke panel */
const reportStatus = (botUuid, status) =>
  post(`/api/remote/bots/${botUuid}/status`, { status });

/** Kirim satu baris console ke panel */
const reportConsoleLine = (botUuid, line) =>
  post(`/api/remote/bots/${botUuid}/logs`, { line });

/** Kirim resource stats ke panel */
const reportStats = (botUuid, stats) =>
  post(`/api/remote/bots/${botUuid}/stats`, stats);

/** Lapor backup selesai */
const reportBackupComplete = (botUuid, backupUuid, success, checksum = null, bytes = null) =>
  post(`/api/remote/bots/${botUuid}/backups/${backupUuid}/complete`, { success, checksum, bytes });

/** Ambil install config dari panel */
const fetchInstallConfig = (botUuid) =>
  get(`/api/remote/bots/${botUuid}/install-config`);

/** Heartbeat */
const heartbeat = (payload) =>
  post('/api/remote/heartbeat', payload);

module.exports = { reportStatus, reportConsoleLine, reportStats, reportBackupComplete, fetchInstallConfig, heartbeat };
