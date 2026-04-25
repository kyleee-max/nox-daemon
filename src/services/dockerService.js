// src/services/dockerService.js
// ─────────────────────────────────────────────────────────────
// YoruSec Nox — Docker Service
// Semua interaksi dengan Docker daemon lewat sini.
// ─────────────────────────────────────────────────────────────
'use strict';

const Docker = require('dockerode');
const path   = require('path');
const logger = require('../utils/logger');
const { getBotDir } = require('../utils/fs');

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

/**
 * Container name untuk bot tertentu
 */
function containerName(botUuid) {
  return `nox_bot_${botUuid.replace(/-/g, '_')}`;
}

/**
 * Get container object (tidak start/stop, hanya referensi).
 */
function getContainer(botUuid) {
  return docker.getContainer(containerName(botUuid));
}

/**
 * Inspect container — returns null jika tidak ada.
 */
async function inspectContainer(botUuid) {
  try {
    return await getContainer(botUuid).inspect();
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Pastikan image sudah ada, pull kalau belum.
 */
async function ensureImage(image) {
  try {
    await docker.getImage(image).inspect();
    logger.debug(`Image ${image} already present.`);
  } catch (err) {
    if (err.statusCode === 404) {
      logger.info(`Pulling image: ${image}`);
      await new Promise((resolve, reject) => {
        docker.pull(image, (err, stream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream,
            (err) => err ? reject(err) : resolve(),
            (event) => logger.debug(`Pull: ${event.status || ''}`)
          );
        });
      });
      logger.info(`Image pulled: ${image}`);
    } else {
      throw err;
    }
  }
}

/**
 * Buat dan start container untuk bot.
 * Config datang dari panel via installConfig.
 */
async function createAndStartContainer(botUuid, config) {
  const {
    docker_image,
    startup_cmd,
    environment = {},
    cpu_limit   = 100,    // % of 1 core
    memory_limit = 512,   // MB
    disk_limit   = 1024,  // MB (soft — via ulimit)
    memory_swap  = 0,
    io_weight    = 500,
    oom_killer   = true,
  } = config;

  await ensureImage(docker_image);

  const hostDir = getBotDir(botUuid);
  const name    = containerName(botUuid);

  // Hapus container lama kalau ada
  await removeContainer(botUuid, true);

  // Build env array: ["KEY=value", ...]
  const envArray = Object.entries(environment).map(([k, v]) => `${k}=${v}`);

  // Parse startup_cmd — ganti {{TOKEN}} dengan env value
  const finalCmd = replacePlaceholders(startup_cmd, environment);

  const containerConfig = {
    name,
    Image: docker_image,
    Cmd:   ['/bin/sh', '-c', finalCmd],
    Env:   envArray,
    WorkingDir: '/home/container',
    AttachStdin:  true,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin:    true,
    Tty:          true,
    HostConfig: {
      Binds:       [`${hostDir}:/home/container`],
      // CPU: NanoCPUs = (cpu_limit / 100) * 1e9
      NanoCpus:    Math.floor((cpu_limit / 100) * 1e9),
      // Memory in bytes
      Memory:      memory_limit * 1024 * 1024,
      MemorySwap:  memory_swap > 0 ? (memory_limit + memory_swap) * 1024 * 1024 : -1,
      BlkioWeight: io_weight,
      OomKillDisable: !oom_killer,
      RestartPolicy: { Name: 'no' },
      NetworkMode: 'bridge',
      // Security: no new privileges
      SecurityOpt: ['no-new-privileges:true'],
      // Read-only root FS kecuali /home/container dan /tmp
      Tmpfs: { '/tmp': 'rw,exec,nosuid,size=50m' },
    },
    Labels: {
      'yorusec.bot.uuid':    botUuid,
      'yorusec.managed':     'true',
    },
  };

  const container = await docker.createContainer(containerConfig);
  await container.start();

  logger.info(`Container started: ${name}`);
  return container;
}

/**
 * Stop container dengan sinyal tertentu.
 * signal: 'stop' | 'kill' | 'restart'
 */
async function powerAction(botUuid, signal) {
  const container = getContainer(botUuid);

  switch (signal) {
    case 'start': {
      const info = await inspectContainer(botUuid);
      if (!info) throw Object.assign(new Error('Container not found. Bot needs to be installed first.'), { status: 404 });
      if (info.State.Running) throw Object.assign(new Error('Bot is already running.'), { status: 400 });
      await container.start();
      break;
    }
    case 'stop': {
      const info = await inspectContainer(botUuid);
      if (!info?.State?.Running) throw Object.assign(new Error('Bot is not running.'), { status: 400 });
      await container.stop({ t: 10 }); // 10 detik grace period
      break;
    }
    case 'restart': {
      const info = await inspectContainer(botUuid);
      if (!info) throw Object.assign(new Error('Container not found.'), { status: 404 });
      await container.restart({ t: 10 });
      break;
    }
    case 'kill': {
      try { await container.kill(); } catch { /* ignore jika tidak running */ }
      break;
    }
    default:
      throw Object.assign(new Error(`Unknown signal: ${signal}`), { status: 400 });
  }
}

/**
 * Kirim command ke stdin container (simulasi console input).
 */
async function sendCommand(botUuid, command) {
  const info = await inspectContainer(botUuid);
  if (!info?.State?.Running) {
    throw Object.assign(new Error('Bot is not running.'), { status: 400 });
  }

  const container = getContainer(botUuid);
  const exec = await container.exec({
    AttachStdin:  true,
    AttachStdout: false,
    AttachStderr: false,
    Cmd:          ['/bin/sh', '-c', `echo "${command.replace(/"/g, '\\"')}" > /proc/1/fd/0`],
  });

  await exec.start({ hijack: true, stdin: true });
}

/**
 * Ambil resource usage container.
 */
async function getStats(botUuid) {
  const info = await inspectContainer(botUuid);
  if (!info?.State?.Running) {
    return { state: 'offline', cpu_absolute: 0, memory_bytes: 0, disk_bytes: 0, network_rx: 0, network_tx: 0, uptime: 0 };
  }

  return new Promise((resolve, reject) => {
    getContainer(botUuid).stats({ stream: false }, (err, data) => {
      if (err) return reject(err);

      // CPU %
      const cpuDelta    = data.cpu_stats.cpu_usage.total_usage - data.precpu_stats.cpu_usage.total_usage;
      const systemDelta = data.cpu_stats.system_cpu_usage - data.precpu_stats.system_cpu_usage;
      const cpuCount    = data.cpu_stats.online_cpus || 1;
      const cpuPercent  = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

      // Memory
      const memUsage = data.memory_stats.usage || 0;
      const memCache = data.memory_stats.stats?.cache || 0;
      const memNet   = memUsage - memCache;

      // Network
      const networks = data.networks || {};
      let netRx = 0, netTx = 0;
      for (const iface of Object.values(networks)) {
        netRx += iface.rx_bytes || 0;
        netTx += iface.tx_bytes || 0;
      }

      // Uptime
      const startedAt = new Date(info.State.StartedAt).getTime();
      const uptime    = Math.floor((Date.now() - startedAt) / 1000);

      resolve({
        state:          'running',
        cpu_absolute:   Math.round(cpuPercent * 100) / 100,
        memory_bytes:   memNet,
        memory_limit:   data.memory_stats.limit || 0,
        disk_bytes:     0, // disk usage perlu separate du call
        network_rx:     netRx,
        network_tx:     netTx,
        uptime,
      });
    });
  });
}

/**
 * Attach ke container stdout/stderr untuk stream console.
 * Callback dipanggil setiap ada output baru.
 */
async function attachConsole(botUuid, onData) {
  const info = await inspectContainer(botUuid);
  if (!info?.State?.Running) return null;

  const container = getContainer(botUuid);
  const stream = await container.logs({
    follow:     true,
    stdout:     true,
    stderr:     true,
    timestamps: false,
    tail:       50,
  });

  container.modem.demuxStream(stream, {
    write: (chunk) => {
      const lines = chunk.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) onData(line);
    },
  }, {
    write: (chunk) => {
      const lines = chunk.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) onData(`\x1b[31m${line}\x1b[0m`); // stderr merah
    },
  });

  return stream;
}

/**
 * Hapus container (force = kill dulu kalau running).
 */
async function removeContainer(botUuid, silent = false) {
  try {
    const container = getContainer(botUuid);
    await container.remove({ force: true });
    logger.debug(`Container removed: ${containerName(botUuid)}`);
  } catch (err) {
    if (!silent && err.statusCode !== 404) throw err;
  }
}

/**
 * Replace {{ENV_VAR}} placeholders dalam startup command.
 */
function replacePlaceholders(cmd, env) {
  return cmd.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => env[key] ?? match);
}

module.exports = {
  docker,
  containerName,
  getContainer,
  inspectContainer,
  ensureImage,
  createAndStartContainer,
  powerAction,
  sendCommand,
  getStats,
  attachConsole,
  removeContainer,
};
