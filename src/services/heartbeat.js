// src/services/heartbeat.js
'use strict';

const os     = require('os');
const logger = require('../utils/logger');
const panel  = require('../utils/panelClient');

const INTERVAL_MS = 30_000;
let timer = null;

function startHeartbeat() {
  if (timer) return;

  // Kirim langsung saat boot
  sendHeartbeat();

  timer = setInterval(sendHeartbeat, INTERVAL_MS);
  logger.info('Heartbeat started (interval: 30s)');
}

function stopHeartbeat() {
  if (timer) { clearInterval(timer); timer = null; }
}

async function sendHeartbeat() {
  try {
    const payload = {
      version:      '1.0.0',
      cpu_count:    os.cpus().length,
      memory_total: os.totalmem(),
      memory_free:  os.freemem(),
      disk_total:   0, // bisa ditambah dengan df parsing
      load_avg:     os.loadavg(),
      uptime:       os.uptime(),
    };

    await panel.heartbeat(payload);
    logger.debug('Heartbeat sent.');
  } catch (err) {
    logger.warn(`Heartbeat failed: ${err.message}`);
  }
}

module.exports = { startHeartbeat, stopHeartbeat };
