// src/controllers/powerController.js
'use strict';

const docker = require('../services/dockerService');
const pm     = require('../services/processManager');
const panel  = require('../utils/panelClient');
const logger = require('../utils/logger');

// POST /api/bots/:botUuid/power  { signal: start|stop|restart|kill }
async function power(req, res, next) {
  const { botUuid } = req.params;
  const { signal }  = req.body;

  if (!['start','stop','restart','kill'].includes(signal)) {
    return res.status(400).json({ error: 'Invalid signal. Use: start, stop, restart, kill' });
  }

  // Kirim 202 langsung, proses async
  res.status(202).json({ data: { signal, queued: true } });

  try {
    const statusMap = {
      start:   'starting',
      stop:    'stopping',
      restart: 'stopping',
      kill:    'stopping',
    };

    pm.setStatus(botUuid, statusMap[signal]);
    await panel.reportStatus(botUuid, statusMap[signal]);

    await docker.powerAction(botUuid, signal);

    // Setelah action selesai, cek state container
    const info   = await docker.inspectContainer(botUuid);
    const status = info?.State?.Running ? 'running' : 'offline';

    pm.setStatus(botUuid, status);
    await panel.reportStatus(botUuid, status);

    // Kalau running, mulai stream console + stats
    if (status === 'running') {
      startConsoleStream(botUuid);
      startStatsStream(botUuid);
    } else {
      pm.clearStream(botUuid);
      pm.clearStatsInterval(botUuid);
    }

    logger.info(`Bot ${botUuid} power ${signal} → ${status}`);
  } catch (err) {
    logger.error(`Power action failed for ${botUuid}: ${err.message}`);
    pm.setStatus(botUuid, 'offline');
    await panel.reportStatus(botUuid, 'offline');
    await panel.reportConsoleLine(botUuid, `\x1b[31m[Nox] Power action failed: ${err.message}\x1b[0m`);
  }
}

/**
 * Stream console output ke panel terus-menerus.
 */
async function startConsoleStream(botUuid) {
  pm.clearStream(botUuid);

  try {
    const stream = await docker.attachConsole(botUuid, async (line) => {
      await panel.reportConsoleLine(botUuid, line);
    });

    if (stream) {
      pm.setStream(botUuid, stream);

      // Deteksi kalau container mati
      stream.on('end', async () => {
        logger.debug(`Console stream ended for ${botUuid}`);
        pm.clearStream(botUuid);
        pm.clearStatsInterval(botUuid);

        const info = await docker.inspectContainer(botUuid);
        if (!info?.State?.Running) {
          pm.setStatus(botUuid, 'offline');
          await panel.reportStatus(botUuid, 'offline');
          await panel.reportConsoleLine(botUuid, '\x1b[33m[Nox] Bot process exited.\x1b[0m');
        }
      });
    }
  } catch (err) {
    logger.error(`Console stream error for ${botUuid}: ${err.message}`);
  }
}

/**
 * Kirim resource stats ke panel setiap 5 detik.
 */
function startStatsStream(botUuid) {
  pm.clearStatsInterval(botUuid);

  const interval = setInterval(async () => {
    try {
      const stats = await docker.getStats(botUuid);
      await panel.reportStats(botUuid, stats);

      // Stop interval kalau bot sudah offline
      if (stats.state === 'offline') {
        pm.clearStatsInterval(botUuid);
      }
    } catch (err) {
      logger.debug(`Stats error for ${botUuid}: ${err.message}`);
      pm.clearStatsInterval(botUuid);
    }
  }, 5000);

  pm.setStatsInterval(botUuid, interval);
}

module.exports = { power, startConsoleStream, startStatsStream };
