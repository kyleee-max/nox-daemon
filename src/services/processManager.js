// src/services/processManager.js
// ─────────────────────────────────────────────────────────────
// Track semua bot yang sedang running + active console streams
// ─────────────────────────────────────────────────────────────
'use strict';

const logger = require('../utils/logger');

/**
 * Map<botUuid, { status, stream, statsInterval }>
 */
const processes = new Map();

function set(botUuid, data) {
  const existing = processes.get(botUuid) || {};
  processes.set(botUuid, { ...existing, ...data });
}

function get(botUuid) {
  return processes.get(botUuid) || null;
}

function getStatus(botUuid) {
  return processes.get(botUuid)?.status || 'offline';
}

function setStatus(botUuid, status) {
  set(botUuid, { status });
  logger.debug(`Process status: ${botUuid} → ${status}`);
}

function setStream(botUuid, stream) {
  set(botUuid, { stream });
}

function getStream(botUuid) {
  return processes.get(botUuid)?.stream || null;
}

function clearStream(botUuid) {
  const proc = processes.get(botUuid);
  if (proc?.stream) {
    try { proc.stream.destroy(); } catch { /* ignore */ }
    set(botUuid, { stream: null });
  }
}

function setStatsInterval(botUuid, interval) {
  set(botUuid, { statsInterval: interval });
}

function clearStatsInterval(botUuid) {
  const proc = processes.get(botUuid);
  if (proc?.statsInterval) {
    clearInterval(proc.statsInterval);
    set(botUuid, { statsInterval: null });
  }
}

function remove(botUuid) {
  clearStream(botUuid);
  clearStatsInterval(botUuid);
  processes.delete(botUuid);
}

function all() {
  return Array.from(processes.entries()).map(([uuid, data]) => ({
    uuid,
    ...data,
    stream: !!data.stream, // jangan expose stream object
  }));
}

module.exports = { set, get, getStatus, setStatus, setStream, getStream, clearStream, setStatsInterval, clearStatsInterval, remove, all };
