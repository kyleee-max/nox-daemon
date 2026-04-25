// src/utils/fs.js
'use strict';

const path   = require('path');
const fse    = require('fs-extra');
const logger = require('./logger');

const DATA_DIR   = process.env.DATA_DIR   || '/var/lib/yorusec/bots';
const BACKUP_DIR = process.env.BACKUP_DIR || '/var/lib/yorusec/backups';

/**
 * Ensure all required data directories exist on startup.
 */
async function ensureDataDirs() {
  await fse.ensureDir(DATA_DIR);
  await fse.ensureDir(BACKUP_DIR);
  logger.info(`Data dir:   ${DATA_DIR}`);
  logger.info(`Backup dir: ${BACKUP_DIR}`);
}

/**
 * Get the root data directory for a specific bot.
 * e.g. /var/lib/yorusec/bots/<botUuid>/
 */
function getBotDir(botUuid) {
  return path.join(DATA_DIR, botUuid);
}

/**
 * Get backup directory for a bot.
 */
function getBackupDir(botUuid) {
  return path.join(BACKUP_DIR, botUuid);
}

/**
 * Resolve a user-supplied path safely within a bot's root directory.
 * Prevents path traversal attacks (e.g. ../../etc/passwd).
 *
 * @param {string} botUuid
 * @param {string} userPath  - e.g. "/src/index.js" or "src/index.js"
 * @returns {string} safe absolute path
 * @throws {Error} if path escapes bot root
 */
function safePath(botUuid, userPath) {
  const root     = path.resolve(getBotDir(botUuid));
  const resolved = path.resolve(root, userPath.replace(/^\/+/, ''));

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw Object.assign(new Error('Path traversal detected.'), { status: 400 });
  }

  return resolved;
}

/**
 * List files in a directory, returns array of file info objects.
 */
async function listDir(botUuid, dir = '/') {
  const fullPath = safePath(botUuid, dir);
  await fse.ensureDir(fullPath);

  const entries = await fse.readdir(fullPath, { withFileTypes: true });

  const result = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(fullPath, entry.name);
    let size = 0;
    let mimetype = 'inode/directory';

    try {
      const stat = await fse.stat(entryPath);
      size = stat.size;
      if (entry.isFile()) mimetype = guessMimetype(entry.name);
    } catch { /* ignore stat errors */ }

    return {
      name:      entry.name,
      path:      path.posix.join(dir.replace(/\\/g, '/'), entry.name),
      is_file:   entry.isFile(),
      is_dir:    entry.isDirectory(),
      is_symlink: entry.isSymbolicLink(),
      size,
      mimetype,
    };
  }));

  // Sort: directories first, then files
  return result.sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1;
    if (!a.is_dir && b.is_dir) return 1;
    return a.name.localeCompare(b.name);
  });
}

function guessMimetype(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.json': 'application/json',
    '.env': 'text/plain',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.sh': 'application/x-sh',
    '.py': 'text/x-python',
    '.yml': 'text/yaml',
    '.yaml': 'text/yaml',
    '.log': 'text/plain',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
  };
  return map[ext] || 'application/octet-stream';
}

module.exports = { ensureDataDirs, getBotDir, getBackupDir, safePath, listDir };
