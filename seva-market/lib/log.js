/**
 * Structured logger.
 *
 * Pretty, colour-free single-line output while developing; one JSON object per
 * line in production so logs can be shipped to any log drain without parsing
 * bespoke formats. Nothing here ever logs a request body, a password or a
 * session token.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger({
  level = 'info',
  json = false,
  base = {},
  write = (line) => process.stdout.write(line + '\n'),
  writeError = (line) => process.stderr.write(line + '\n')
} = {}) {
  const threshold = LEVELS[String(level).toLowerCase()] ?? LEVELS.info;

  function emit(name, payload) {
    if (LEVELS[name] === undefined || LEVELS[name] < threshold) return;
    const record = { ts: new Date().toISOString(), level: name, ...base, ...payload };
    const out = LEVELS[name] >= LEVELS.warn ? writeError : write;
    if (json) return out(JSON.stringify(record));

    const extras = Object.entries(record)
      .filter(([key]) => !['ts', 'level', 'msg'].includes(key))
      .map(([key, value]) => ` ${key}=${formatValue(value)}`)
      .join('');
    return out(`${record.ts} ${name.toUpperCase().padEnd(5)} ${record.msg ?? ''}${extras}`);
  }

  return {
    level,
    debug: (msg, extra = {}) => emit('debug', { msg, ...extra }),
    info: (msg, extra = {}) => emit('info', { msg, ...extra }),
    warn: (msg, extra = {}) => emit('warn', { msg, ...extra }),
    error: (msg, extra = {}) => emit('error', { msg, ...extra }),
    child(extra = {}) {
      return createLogger({ level, json, base: { ...base, ...extra }, write, writeError });
    }
  };
}

function formatValue(value) {
  if (value instanceof Error) return value.message;
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object]';
    }
  }
  return String(value);
}
