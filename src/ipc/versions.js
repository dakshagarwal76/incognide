const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const os = require('os');
const crypto = require('crypto');

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

function register(ctx) {
  const { ipcMain, log, INCOGNIDE_HOME: ctxIncognideHome } = ctx;

  const INCOGNIDE_HOME = ctxIncognideHome || path.join(os.homedir(), '.incognide');
  const VERSIONS_DIR = path.join(INCOGNIDE_HOME, 'versions');

  const ensureVersionsDir = async () => {
    await fsPromises.mkdir(VERSIONS_DIR, { recursive: true });
  };

  const versionDirFor = (filePath) => {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(INCOGNIDE_HOME, filePath);
    return path.join(VERSIONS_DIR, sha1(abs));
  };

  const indexCache = new Map();
  const indexCacheTTL = 5 * 60 * 1000;

  const readIndex = async (filePath) => {
    const dir = versionDirFor(filePath);
    const cached = indexCache.get(dir);
    if (cached && Date.now() - cached.ts < indexCacheTTL) return cached.index;
    const indexPath = path.join(dir, 'index.json');
    try {
      const raw = await fsPromises.readFile(indexPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        indexCache.set(dir, { index: parsed, ts: Date.now() });
        return parsed;
      }
    } catch {}
    indexCache.set(dir, { index: [], ts: Date.now() });
    return [];
  };

  const writeIndex = async (filePath, index) => {
    const dir = versionDirFor(filePath);
    const indexPath = path.join(dir, 'index.json');
    await fsPromises.writeFile(indexPath, JSON.stringify(index), 'utf8');
    indexCache.set(dir, { index, ts: Date.now() });
  };

  const pruneOlderThan = 24 * 60 * 60 * 1000; // 24 hours

  ipcMain.handle('versions:record', async (event, { filePath, content, origin = 'manual' }) => {
    if (!filePath) return { success: false, error: 'No filePath provided' };
    try {
      const dir = versionDirFor(filePath);

      const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
      const bytes = Buffer.byteLength(content || '', 'utf8');
      if (bytes > MAX_BYTES) {
        return { success: false, skipped: true, reason: 'oversized' };
      }

      const contentHash = crypto.createHash('sha256').update(content || '', 'utf8').digest('hex');

      let index = await readIndex(filePath);
      const now = Date.now();
      const newest = index[index.length - 1];

      if (newest && newest.hash === contentHash) {
        return { success: true, skipped: true, id: newest.id };
      }

      const throttleAutosaveMs = 60 * 1000;
      if (origin === 'autosave' && newest?.origin === 'autosave' && now - newest.ts < throttleAutosaveMs) {
        return { success: true, skipped: true, id: newest.id, reason: 'autosave-throttle' };
      }

      if (index.length > 200 || Math.random() < 0.05) {
        let prunedCount = 0;
        const kept = [];
        for (const entry of index) {
          if (now - entry.ts > pruneOlderThan) {
            try { await fsPromises.unlink(path.join(dir, `${entry.id}.txt`)); } catch {}
            prunedCount++;
          } else {
            kept.push(entry);
          }
        }
        index = kept;
        if (prunedCount > 0) {
          await writeIndex(filePath, index);
        }
      }

      await fsPromises.mkdir(dir, { recursive: true });
      const id = `${now}-${origin}`;
      const snapshotPath = path.join(dir, `${id}.txt`);
      const nextIndex = [...index, { id, ts: now, origin, bytes, hash: contentHash }];

      await fsPromises.writeFile(snapshotPath, content || '', 'utf8');
      await writeIndex(filePath, nextIndex);

      return { success: true, id };
    } catch (err) {
      log?.('[Versions] record error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('versions:list', async (event, { filePath, limit = 50 }) => {
    if (!filePath) return { versions: [] };
    try {
      const dir = versionDirFor(filePath);
      const index = await readIndex(filePath);
      const versions = [];
      for (let i = index.length - 1; i >= 0; i--) {
        const entry = index[i];
        try {
          await fsPromises.access(path.join(dir, `${entry.id}.txt`), fs.constants.F_OK);
          versions.push(entry);
        } catch {}
        if (versions.length >= limit) break;
      }
      return { versions };
    } catch (err) {
      log?.('[Versions] list error:', err.message);
      return { versions: [], error: err.message };
    }
  });

  ipcMain.handle('versions:read', async (event, { filePath, id }) => {
    if (!filePath || !id) return { content: null, error: 'Missing filePath or id' };
    try {
      const dir = versionDirFor(filePath);
      const file = path.join(dir, `${id}.txt`);
      const content = await fsPromises.readFile(file, 'utf8');
      return { content };
    } catch (err) {
      log?.('[Versions] read error:', err.message);
      return { content: null, error: err.message };
    }
  });
}

module.exports = { register };
