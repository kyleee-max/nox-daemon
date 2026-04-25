// src/middleware/authenticate.js
// ─────────────────────────────────────────────────────────────
// Nox verifikasi request dari panel:
//   Authorization: Bearer <raw_token>
//   X-Nox-Timestamp: <unix_ms>
//   X-Nox-Signature: HMAC-SHA256(timestamp:METHOD:path:body)
// ─────────────────────────────────────────────────────────────
'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

const RAW_TOKEN    = process.env.NOX_TOKEN    || '';
const CLOCK_SKEW_MS = 30_000; // tolerate 30 detik clock skew

function authenticate(req, res, next) {
  try {
    // 1. Ambil Bearer token
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header.' });
    }

    const token = authHeader.slice(7).trim();

    // 2. Bandingkan token dengan constant-time compare
    if (!RAW_TOKEN) {
      logger.error('NOX_TOKEN not configured!');
      return res.status(500).json({ error: 'Daemon misconfigured.' });
    }

    const tokenBuf = Buffer.from(token.padEnd(RAW_TOKEN.length));
    const secretBuf = Buffer.from(RAW_TOKEN.padEnd(token.length));
    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      logger.warn(`Auth failed from ${req.ip} — bad token`);
      return res.status(401).json({ error: 'Invalid token.' });
    }

    // 3. Verifikasi HMAC signature (jika ada — panel selalu mengirimkan ini)
    const timestamp = req.headers['x-nox-timestamp'];
    const signature = req.headers['x-nox-signature'];

    if (timestamp && signature) {
      // Cek clock skew
      const ts = parseInt(timestamp);
      if (isNaN(ts) || Math.abs(Date.now() - ts) > CLOCK_SKEW_MS) {
        logger.warn(`Auth failed from ${req.ip} — timestamp out of range`);
        return res.status(401).json({ error: 'Request timestamp expired.' });
      }

      // Rebuild body string sama seperti panel
      const bodyStr   = req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : '';
      const expected  = crypto
        .createHmac('sha256', RAW_TOKEN)
        .update(`${timestamp}:${req.method}:${req.path}:${bodyStr}`)
        .digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        logger.warn(`Auth failed from ${req.ip} — bad HMAC signature`);
        return res.status(401).json({ error: 'Invalid request signature.' });
      }
    }

    next();
  } catch (err) {
    logger.error('Auth middleware error:', err.message);
    return res.status(401).json({ error: 'Authentication error.' });
  }
}

module.exports = { authenticate };
