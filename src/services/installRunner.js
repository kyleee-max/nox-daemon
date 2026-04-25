// src/services/installRunner.js
// ─────────────────────────────────────────────────────────────
// Jalankan install_script bot di dalam container temporary
// Mirip cara Wings Pterodactyl handle egg installation
// ─────────────────────────────────────────────────────────────
'use strict';

const Docker = require('dockerode');
const path   = require('path');
const fse    = require('fs-extra');
const logger = require('../utils/logger');
const panel  = require('../utils/panelClient');
const pm     = require('./processManager');
const { getBotDir, ensureDataDirs } = require('../utils/fs');

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

/**
 * Run install script untuk bot.
 * 1. Fetch config dari panel
 * 2. Pull install image
 * 3. Jalankan install_script di container
 * 4. Report status ke panel
 */
async function runInstall(botUuid) {
  logger.info(`[Install] Starting install for bot ${botUuid}`);
  pm.setStatus(botUuid, 'installing');
  await panel.reportStatus(botUuid, 'installing');

  try {
    // 1. Ambil config dari panel
    const result = await panel.fetchInstallConfig(botUuid);
    if (!result?.data) {
      throw new Error('Failed to fetch install config from panel.');
    }

    const config = result.data;
    const {
      install_script,
      install_image = 'node:20-alpine',
      environment   = {},
    } = config;

    // 2. Pastikan bot dir ada
    const botDir = getBotDir(botUuid);
    await fse.ensureDir(botDir);

    // 3. Tulis install script ke file temp
    const scriptPath = path.join(botDir, '.install.sh');
    await fse.writeFile(scriptPath, install_script || '#!/bin/bash\necho "No install script."', 'utf8');
    await fse.chmod(scriptPath, '755');

    // 4. Pull install image
    await pullImage(install_image);

    // 5. Jalankan install container
    const envArray = Object.entries(environment).map(([k, v]) => `${k}=${v}`);
    const containerName = `nox_install_${botUuid.replace(/-/g, '_')}`;

    // Cleanup kalau ada sisa container install sebelumnya
    try { await docker.getContainer(containerName).remove({ force: true }); } catch { /* ignore */ }

    const container = await docker.createContainer({
      name: containerName,
      Image: install_image,
      Cmd: ['/bin/sh', '/mnt/install.sh'],
      Env: envArray,
      WorkingDir: '/home/container',
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      HostConfig: {
        Binds: [
          `${botDir}:/home/container`,
          `${scriptPath}:/mnt/install.sh:ro`,
        ],
        AutoRemove: false,
        NetworkMode: 'bridge',
        Memory: 512 * 1024 * 1024, // 512MB untuk install
      },
      Labels: {
        'yorusec.bot.uuid':  botUuid,
        'yorusec.install':   'true',
      },
    });

    // 6. Stream output ke panel console
    const stream = await container.attach({ stream: true, stdout: true, stderr: true });
    container.modem.demuxStream(stream,
      { write: (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          panel.reportConsoleLine(botUuid, line);
        }
      }},
      { write: (chunk) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          panel.reportConsoleLine(botUuid, `\x1b[33m[INSTALL] ${line}\x1b[0m`);
        }
      }}
    );

    await container.start();

    // 7. Tunggu sampai install selesai
    const { StatusCode } = await container.wait();

    // Cleanup install container
    try { await container.remove({ force: true }); } catch { /* ignore */ }
    await fse.remove(scriptPath);

    if (StatusCode !== 0) {
      throw new Error(`Install script exited with code ${StatusCode}`);
    }

    logger.info(`[Install] Bot ${botUuid} installed successfully.`);
    pm.setStatus(botUuid, 'offline');
    await panel.reportStatus(botUuid, 'offline');
    await panel.reportConsoleLine(botUuid, '\x1b[32m[YoruSec] Install complete. Bot is ready.\x1b[0m');

  } catch (err) {
    logger.error(`[Install] Bot ${botUuid} install failed: ${err.message}`);
    pm.setStatus(botUuid, 'install_failed');
    await panel.reportStatus(botUuid, 'install_failed');
    await panel.reportConsoleLine(botUuid, `\x1b[31m[YoruSec] Install failed: ${err.message}\x1b[0m`);
  }
}

async function pullImage(image) {
  try {
    await docker.getImage(image).inspect();
  } catch (err) {
    if (err.statusCode === 404) {
      logger.info(`[Install] Pulling image: ${image}`);
      await new Promise((resolve, reject) => {
        docker.pull(image, (err, stream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream,
            (err) => err ? reject(err) : resolve(),
            (event) => {
              if (event.status) logger.debug(`[Pull] ${event.status}`);
            }
          );
        });
      });
    } else throw err;
  }
}

module.exports = { runInstall };
