// src/controllers/systemController.js
'use strict';

const os     = require('os');
const Docker = require('dockerode');
const pm     = require('../services/processManager');

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

// GET /api/system
async function ping(req, res, next) {
  try {
    let dockerOk = false;
    try { await docker.ping(); dockerOk = true; } catch { /* ignore */ }

    return res.json({
      data: {
        version:    '1.0.0',
        docker:     dockerOk,
        cpu_count:  os.cpus().length,
        memory:     { total: os.totalmem(), free: os.freemem() },
        uptime:     os.uptime(),
        load_avg:   os.loadavg(),
        bots_tracked: pm.all().length,
      },
    });
  } catch (err) { next(err); }
}

// GET /api/system/docker
async function dockerInfo(req, res, next) {
  try {
    const info = await docker.info();
    return res.json({
      data: {
        containers:         info.Containers,
        containers_running: info.ContainersRunning,
        images:             info.Images,
        docker_version:     info.ServerVersion,
        os:                 info.OperatingSystem,
        architecture:       info.Architecture,
        memory_total:       info.MemTotal,
      },
    });
  } catch (err) { next(err); }
}

module.exports = { ping, dockerInfo };
