'use strict';

const fs = require('fs');
const path = require('path');

class FsTools {
  constructor(rootDir = null) {
    this.root = rootDir || path.join(__dirname, '../../../');
  }

  // Safe read - only READ permission
  listDir(dirPath, options = {}) {
    const full = path.join(this.root, dirPath);
    if (!fs.existsSync(full)) return { success: false, error: `Path not found: ${dirPath}` };
    try {
      const stat = fs.statSync(full);
      if (!stat.isDirectory()) return { success: false, error: `Not a directory: ${dirPath}` };
      const entries = fs.readdirSync(full, { withFileTypes: true });
      const result = entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        path: path.join(dirPath, e.name)
      }));
      // Filter hidden if needed
      const filtered = options.showHidden ? result : result.filter(r => !r.name.startsWith('.'));
      return { success: true, entries: filtered, count: filtered.length, path: dirPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  readFile(filePath, maxSize = 1024 * 1024) {
    const full = path.join(this.root, filePath);
    try {
      if (!fs.existsSync(full)) return { success: false, error: `File not found: ${filePath}` };
      const stat = fs.statSync(full);
      if (stat.size > maxSize) return { success: false, error: `File too large: ${stat.size} bytes > ${maxSize}` };
      if (!stat.isFile()) return { success: false, error: `Not a file: ${filePath}` };
      const content = fs.readFileSync(full, 'utf8');
      return { success: true, content, size: stat.size, path: filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getFileInfo(filePath) {
    const full = path.join(this.root, filePath);
    try {
      if (!fs.existsSync(full)) return { success: false, error: `Not found: ${filePath}` };
      const stat = fs.statSync(full);
      return {
        success: true,
        path: filePath,
        size: stat.size,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        mtime: stat.mtime,
        birthtime: stat.birthtime
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Safe search for files by pattern
  findFiles(dirPath, pattern, maxDepth = 3, currentDepth = 0) {
    if (currentDepth > maxDepth) return { success: true, files: [] };
    const full = path.join(this.root, dirPath);
    if (!fs.existsSync(full)) return { success: false, error: `Path not found: ${dirPath}`, files: [] };
    try {
      const entries = fs.readdirSync(full, { withFileTypes: true });
      let files = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const rel = path.join(dirPath, entry.name);
        if (entry.isFile() && rel.match(pattern)) files.push(rel);
        else if (entry.isDirectory()) {
          const sub = this.findFiles(rel, pattern, maxDepth, currentDepth + 1);
          if (sub.success) files = files.concat(sub.files);
        }
      }
      return { success: true, files, count: files.length };
    } catch (err) {
      return { success: false, error: err.message, files: [] };
    }
  }

  // Safe write - requires WRITE permission check externally
  writeFileSafe(filePath, content, options = {}) {
    const full = path.join(this.root, filePath);
    try {
      // Prevent writing to sensitive files unless explicitly allowed
      const sensitive = ['.env', 'server.js', 'package.json', 'supabase/', 'data/'];
      const isSensitive = sensitive.some(s => filePath.includes(s));
      if (isSensitive && !options.allowSensitive) {
        return { success: false, error: `Sensitive file write requires explicit approval: ${filePath}`, blocked: true };
      }
      // Ensure dir exists
      const dir = path.dirname(full);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      return { success: true, path: filePath, size: content.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getProjectStats() {
    try {
      const rootEntries = this.listDir('.', { showHidden: false });
      const packageJson = this.readFile('package.json');
      let pkg = null;
      if (packageJson.success) {
        try { pkg = JSON.parse(packageJson.content); } catch (_) {}
      }
      const serverInfo = this.getFileInfo('server.js');
      const libDir = this.listDir('lib');
      const publicDir = this.listDir('public');
      const agentsDir = this.listDir('agents');

      return {
        success: true,
        rootFiles: rootEntries.success ? rootEntries.entries.length : 0,
        hasPackageJson: !!pkg,
        packageName: pkg?.name,
        dependenciesCount: pkg ? Object.keys(pkg.dependencies || {}).length : 0,
        hasServer: serverInfo.success && serverInfo.isFile,
        serverSize: serverInfo.success ? serverInfo.size : 0,
        libFiles: libDir.success ? libDir.count : 0,
        publicFiles: publicDir.success ? publicDir.count : 0,
        agentsFiles: agentsDir.success ? agentsDir.count : 0,
        rootPath: this.root
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = { FsTools };
