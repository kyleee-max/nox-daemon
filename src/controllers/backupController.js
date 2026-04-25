// src/controllers/backupController.js
'use strict';

const path     = require('path');
const fse      = require('fs-extra');
const archiver = require('archiver');
const extract  = require('extract-zip');
const crypto   = require('crypto');
const { getBotDir, getBackupDir, safePath } = require('../utils/fs');
const panel    = require('../utils/panelClient');
const logger   = require('../utils/logger');

// POST /api/bots/:botUuid/backups  { uuid, ignored }
async function createBackup(req, res, next) {
  try {
    const { botUuid }             = req.params;
    const { uuid: backupUuid, ignored = [] } = req.body;

    if (!backupUuid) return res.status(400).json({ error: 'uuid is required.' });

    // Langsung 202, proses backup async
    res.status(202).json({ data: { uuid: backupUuid, status: 'pending' } });

    // Jalankan async
    runBackup(botUuid, backupUuid, ignored).catch(err => {
      logger.error(`Backup ${backupUuid} error: ${err.message}`);
    });

  } catch (err) { next(err); }
}

async function runBackup(botUuid, backupUuid, ignored = []) {
  const botDir    = getBotDir(botUuid);
  const backupDir = getBackupDir(botUuid);
  await fse.ensureDir(backupDir);

  const archivePath = path.join(backupDir, `${backupUuid}.zip`);

  try {
    await new Promise((resolve, reject) => {
      const output   = fse.createWriteStream(archivePath);
      const archive  = archiver('zip', { zlib: { level: 6 } });

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      // Tambahkan seluruh bot dir, kecuali yang di-ignore
      archive.glob('**/*', {
        cwd:    botDir,
        ignore: [...ignored, '*.log', '.install.sh'],
        dot:    true,
      });

      archive.finalize();
    });

    // Hitung checksum + size
    const stat     = await fse.stat(archivePath);
    const checksum = await hashFile(archivePath);

    logger.info(`Backup ${backupUuid} complete: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

    // Lapor ke panel
    await panel.reportBackupComplete(botUuid, backupUuid, true, checksum, stat.size);

  } catch (err) {
    logger.error(`Backup ${backupUuid} failed: ${err.message}`);
    await panel.reportBackupComplete(botUuid, backupUuid, false);
    await fse.remove(archivePath).catch(() => {});
    throw err;
  }
}

// POST /api/bots/:botUuid/backups/:backupUuid/restore
async function restoreBackup(req, res, next) {
  try {
    const { botUuid, backupUuid } = req.params;

    const archivePath = path.join(getBackupDir(botUuid), `${backupUuid}.zip`);
    if (!await fse.pathExists(archivePath)) {
      return res.status(404).json({ error: 'Backup archive not found.' });
    }

    // 202 — proses async
    res.status(202).json({ data: { status: 'restoring' } });

    const botDir = getBotDir(botUuid);

    // Hapus isi bot dir (kecuali backup sendiri)
    const entries = await fse.readdir(botDir);
    for (const entry of entries) {
      await fse.remove(path.join(botDir, entry));
    }

    // Extract backup
    await extract(archivePath, { dir: botDir });

    logger.info(`Backup ${backupUuid} restored to ${botUuid}`);
    await panel.reportConsoleLine(botUuid, '\x1b[32m[Nox] Backup restored successfully.\x1b[0m');
    await panel.reportStatus(botUuid, 'offline');

  } catch (err) {
    logger.error(`Restore ${req.params.backupUuid} failed: ${err.message}`);
    await panel.reportConsoleLine(req.params.botUuid, `\x1b[31m[Nox] Restore failed: ${err.message}\x1b[0m`);
    next(err);
  }
}

// DELETE /api/bots/:botUuid/backups/:backupUuid
async function deleteBackup(req, res, next) {
  try {
    const { botUuid, backupUuid } = req.params;
    const archivePath = path.join(getBackupDir(botUuid), `${backupUuid}.zip`);
    await fse.remove(archivePath);
    return res.status(204).send();
  } catch (err) { next(err); }
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fse.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = { createBackup, restoreBackup, deleteBackup };
