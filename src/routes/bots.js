// src/routes/bots.js
'use strict';

const router  = require('express').Router();
const power   = require('../controllers/powerController');
const console_ = require('../controllers/consoleController');
const files   = require('../controllers/fileController');
const backups = require('../controllers/backupController');
const install = require('../controllers/installController');

// ── Power ─────────────────────────────────────────────────────
router.post('/:botUuid/power',   power.power);

// ── Console ───────────────────────────────────────────────────
router.post('/:botUuid/command', console_.sendCommand);
router.get ('/:botUuid/resources', console_.getResources);
router.get ('/:botUuid/ws',      console_.getWsToken);

// ── Install ───────────────────────────────────────────────────
router.post('/:botUuid/install', install.install);

// ── Files ─────────────────────────────────────────────────────
router.get ('/:botUuid/files/list',       files.listFiles);
router.get ('/:botUuid/files/contents',   files.getContents);
router.post('/:botUuid/files/write',      files.writeFile);
router.put ('/:botUuid/files/rename',     files.renameFile);
router.post('/:botUuid/files/delete',     files.deleteFiles);
router.post('/:botUuid/files/mkdir',      files.createDir);
router.post('/:botUuid/files/compress',   files.compressFiles);
router.post('/:botUuid/files/decompress', files.decompressFile);

// ── Backups ───────────────────────────────────────────────────
router.post  ('/:botUuid/backups',                    backups.createBackup);
router.post  ('/:botUuid/backups/:backupUuid/restore', backups.restoreBackup);
router.delete('/:botUuid/backups/:backupUuid',         backups.deleteBackup);

module.exports = router;
