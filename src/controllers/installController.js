// src/controllers/installController.js
'use strict';

const { runInstall } = require('../services/installRunner');
const pm     = require('../services/processManager');
const logger = require('../utils/logger');

// POST /api/bots/:botUuid/install
async function install(req, res, next) {
  try {
    const { botUuid } = req.params;

    // Kalau lagi install, skip
    if (pm.getStatus(botUuid) === 'installing') {
      return res.status(409).json({ error: 'Bot is already installing.' });
    }

    // Langsung 202, proses async
    res.status(202).json({ data: { status: 'installing' } });

    // Jalankan install di background
    runInstall(botUuid).catch(err => {
      logger.error(`Install failed for ${botUuid}: ${err.message}`);
    });

  } catch (err) { next(err); }
}

module.exports = { install };
