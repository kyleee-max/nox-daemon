// src/controllers/fileController.js
'use strict';

const path    = require('path');
const fse     = require('fs-extra');
const archiver = require('archiver');
const extract  = require('extract-zip');
const crypto   = require('crypto');
const { safePath, listDir, getBotDir } = require('../utils/fs');
const logger  = require('../utils/logger');

// GET /api/bots/:botUuid/files/list?directory=/
async function listFiles(req, res, next) {
  try {
    const { botUuid } = req.params;
    const dir = req.query.directory || '/';
    const files = await listDir(botUuid, dir);
    return res.json({ data: files });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// GET /api/bots/:botUuid/files/contents?file=/path/to/file.js
async function getContents(req, res, next) {
  try {
    const { botUuid } = req.params;
    const file = req.query.file;
    if (!file) return res.status(400).json({ error: 'file query param is required.' });

    const fullPath = safePath(botUuid, file);

    const stat = await fse.stat(fullPath);
    if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory.' });

    // Limit file size yang bisa dibaca (max 4MB)
    if (stat.size > 4 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large to read. Max 4MB.' });
    }

    const content = await fse.readFile(fullPath, 'utf8');
    return res.json({ data: { content, size: stat.size } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found.' });
    next(err);
  }
}

// POST /api/bots/:botUuid/files/write  { file, content }
async function writeFile(req, res, next) {
  try {
    const { botUuid } = req.params;
    const { file, content = '' } = req.body;
    if (!file) return res.status(400).json({ error: 'file is required.' });

    const fullPath = safePath(botUuid, file);
    await fse.ensureDir(path.dirname(fullPath));
    await fse.writeFile(fullPath, content, 'utf8');
    return res.status(204).send();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// PUT /api/bots/:botUuid/files/rename  { from, to }
async function renameFile(req, res, next) {
  try {
    const { botUuid } = req.params;
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to are required.' });

    const fromPath = safePath(botUuid, from);
    const toPath   = safePath(botUuid, to);

    if (!await fse.pathExists(fromPath)) return res.status(404).json({ error: 'Source not found.' });

    await fse.ensureDir(path.dirname(toPath));
    await fse.move(fromPath, toPath, { overwrite: false });
    return res.status(204).send();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'EEXIST') return res.status(409).json({ error: 'Destination already exists.' });
    next(err);
  }
}

// POST /api/bots/:botUuid/files/delete  { files: ["/path1", "/path2"] }
async function deleteFiles(req, res, next) {
  try {
    const { botUuid } = req.params;
    const { files } = req.body;
    if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'files array is required.' });

    for (const file of files) {
      const fullPath = safePath(botUuid, file);
      await fse.remove(fullPath);
    }

    return res.status(204).send();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// POST /api/bots/:botUuid/files/mkdir  { path }
async function createDir(req, res, next) {
  try {
    const { botUuid } = req.params;
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ error: 'path is required.' });

    const fullPath = safePath(botUuid, dirPath);
    await fse.ensureDir(fullPath);
    return res.status(204).send();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// POST /api/bots/:botUuid/files/compress  { files: [], destination: "/archive.zip" }
async function compressFiles(req, res, next) {
  try {
    const { botUuid }          = req.params;
    const { files, destination } = req.body;
    if (!Array.isArray(files) || !destination) {
      return res.status(400).json({ error: 'files and destination are required.' });
    }

    const destPath = safePath(botUuid, destination);
    await fse.ensureDir(path.dirname(destPath));

    await new Promise((resolve, reject) => {
      const output  = fse.createWriteStream(destPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      for (const file of files) {
        try {
          const fullPath = safePath(botUuid, file);
          const name     = path.basename(fullPath);
          const stat     = fse.statSync(fullPath);

          if (stat.isDirectory()) archive.directory(fullPath, name);
          else archive.file(fullPath, { name });
        } catch { /* skip invalid paths */ }
      }

      archive.finalize();
    });

    return res.status(204).send();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// POST /api/bots/:botUuid/files/decompress  { file, directory }
async function decompressFile(req, res, next) {
  try {
    const { botUuid }         = req.params;
    const { file, directory } = req.body;
    if (!file || !directory) return res.status(400).json({ error: 'file and directory are required.' });

    const filePath   = safePath(botUuid, file);
    const targetPath = safePath(botUuid, directory);

    if (!await fse.pathExists(filePath)) return res.status(404).json({ error: 'Archive not found.' });

    await fse.ensureDir(targetPath);
    await extract(filePath, { dir: targetPath });
    return res.status(204).send();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

module.exports = { listFiles, getContents, writeFile, renameFile, deleteFiles, createDir, compressFiles, decompressFile };
