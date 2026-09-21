'use strict';

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  CRITICAL: 4
};

class Logger {
  constructor(name = 'SP-SAARTHI') {
    this.name = name;
    this.logFile = path.join(LOG_DIR, `${name.toLowerCase()}.log`);
    this.globalFile = path.join(LOG_DIR, 'saarthi-system.log');
  }

  format(level, message, meta = {}) {
    const ts = new Date().toISOString();
    const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
    return `[${ts}] [${level}] [${this.name}] ${message}${metaStr}`;
  }

  write(level, message, meta = {}) {
    const line = this.format(level, message, meta);
    // console
    if (level === 'ERROR' || level === 'CRITICAL') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);

    // file append - best effort
    try {
      fs.appendFileSync(this.globalFile, line + '\n');
      if (this.logFile !== this.globalFile) {
        fs.appendFileSync(this.logFile, line + '\n');
      }
    } catch (_) {}
  }

  debug(msg, meta) { this.write('DEBUG', msg, meta); }
  info(msg, meta) { this.write('INFO', msg, meta); }
  warn(msg, meta) { this.write('WARN', msg, meta); }
  error(msg, meta) { this.write('ERROR', msg, meta); }
  critical(msg, meta) { this.write('CRITICAL', msg, meta); }

  // For task-specific logging
  taskLog(taskId, level, message, meta = {}) {
    const taskFile = path.join(LOG_DIR, `task-${taskId}.log`);
    const line = this.format(level, message, { taskId, ...meta });
    console.log(line);
    try {
      fs.appendFileSync(taskFile, line + '\n');
      fs.appendFileSync(this.globalFile, line + '\n');
    } catch (_) {}
  }

  getLogs(taskId = null, limit = 200) {
    try {
      const file = taskId ? path.join(LOG_DIR, `task-${taskId}.log`) : this.globalFile;
      if (!fs.existsSync(file)) return [];
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.trim().split('\n');
      return lines.slice(-limit);
    } catch {
      return [];
    }
  }
}

// Singleton default logger
const defaultLogger = new Logger('SP-SAARTHI');

module.exports = { Logger, defaultLogger, LEVELS };
