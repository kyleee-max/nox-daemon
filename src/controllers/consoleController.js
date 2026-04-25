// src/controllers/consoleController.js
'use strict';

const docker = require('../services/dockerService');
const pm     = require('../services/processManager');

// POST /api/bots/:botUuid/command  { command: "string" }
async function sendCommand(req, res, next) {
  try {
    const { botUuid } = req.params;
    const { command } = req.body;

    if (!command?.trim()) {
      return res.status(400).json({ error: 'command is required.' });
    }

    await docker.sendCommand(botUuid, command);
    return res.status(204).send();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// GET /api/bots/:botUuid/resources
async function getResources(req, res, next) {
  try {
    const { botUuid } = req.params;
    const stats = await docker.getStats(botUuid);
    return res.json({ data: stats });
  } catch (err) { next(err); }
}

// GET /api/bots/:botUuid/ws
// Return token supaya frontend bisa connect ke Nox socket langsung
async function getWsToken(req, res, next) {
  try {
    const { botUuid } = req.params;
    const crypto = require('crypto');

    // Token sementara — valid 5 menit
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000;

    // Simpan di memory (simple, cukup untuk purpose ini)
    if (!global._wsTokens) global._wsTokens = new Map();
    global._wsTokens.set(token, { botUuid, expiresAt });

    // Cleanup expired tokens
    for (const [k, v] of global._wsTokens) {
      if (v.expiresAt < Date.now()) global._wsTokens.delete(k);
    }

    return res.json({
      data: {
        token,
        socket: `ws://${req.hostname}:${process.env.NOX_PORT || 8080}`,
        expires_at: expiresAt,
      },
    });
  } catch (err) { next(err); }
}

module.exports = { sendCommand, getResources, getWsToken };
