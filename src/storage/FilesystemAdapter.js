import fs from 'node:fs/promises';
import path from 'node:path';

export class FilesystemAdapter {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  filePath(key) {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baseDir, `${safe}.json`);
  }

  async set(key, value) {
    await fs.mkdir(this.baseDir, { recursive: true });
    const tmp = `${this.filePath(key)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(tmp, this.filePath(key));
  }

  async get(key) {
    try {
      const raw = await fs.readFile(this.filePath(key), 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async del(key) {
    try {
      await fs.unlink(this.filePath(key));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}