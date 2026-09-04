import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const ADMIN_EMAIL = 'admin@test.example';
export const ADMIN_PASSWORD = 'TestAdmin123!';
export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGP8//8/AzbAxIAHMGES+P//PxMDXsCEzjGMSg8AADJkCwlQn8RQAAAAAElFTkSuQmCC';

/** Only explicitly supplied mock credentials may reach test child processes. */
export function testEnvironment() {
  return {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    NODE_NO_WARNINGS: '1',
    HOST: '127.0.0.1',
    PJS_STORAGE: process.env.PJS_STORAGE === 'json' ? 'json' : 'sqlite'
  };
}

export function inheritedMockEnvironment() {
  if (process.env.PJS_TEST_MOCK_CLOUD !== '1') return {};
  const keys = ['CF_ACCOUNT_ID', 'CF_D1_DATABASE_ID', 'CF_D1_API_TOKEN', 'CF_D1_API_URL',
    'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_PREFIX'];
  for (const key of ['CF_D1_API_URL', 'R2_ENDPOINT']) {
    const url = new URL(process.env[key]);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
      throw new Error('Local test suite refuses a non-loopback cloud endpoint.');
    }
  }
  return { PJS_STORAGE: 'd1', ...Object.fromEntries(keys.map((key) => [key, process.env[key]])) };
}

/** An isolated app: never inherit production storage, mail or owner credentials. */
export async function startTestApp(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjs-regression-'));
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...testEnvironment(),
      PORT: String(port),
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      ...overrides,
      PJS_DATA_DIR: dataDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });

  async function stop() {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
      });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Test server did not start:\n${log}`)), 15000);
      child.once('error', (err) => { clearTimeout(timer); reject(err); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Test server exited:\n${log}`)); });
      child.stdout.on('data', () => {
        if (log.includes('is running')) { clearTimeout(timer); resolve(); }
      });
    });
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    base, dataDir, stop,
    client: () => createClient(base),
    mailLink: (email, page) => readMailLink(dataDir, email, page)
  };
}

/** Read only a disposable test outbox; production tokens are not exposed by APIs. */
export function readMailLink(dataDir, email, page) {
  const folder = path.join(dataDir, 'outbox');
  for (const file of fs.readdirSync(folder).sort().reverse()) {
    const text = fs.readFileSync(path.join(folder, file), 'utf8');
    if (!text.startsWith(`To: ${email}\r\n`)) continue;
    const link = text.match(new RegExp(`https?://[^\\s]+/${page}\\?token=[a-zA-Z0-9]+`));
    if (link) return new URL(link[0]);
  }
  throw new Error(`No ${page} email for test account ${email}`);
}

export function createClient(base) {
  let cookie = '';
  async function raw(url, options = {}) {
    const res = await fetch(base + url, {
      ...options,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
      signal: AbortSignal.timeout(15000)
    });
    const session = res.headers.getSetCookie().find((value) => value.startsWith('pjs_session='));
    if (session) cookie = /Max-Age=0(?:;|$)/.test(session) ? '' : session.split(';')[0];
    return res;
  }
  async function request(method, url, body) {
    const res = await raw(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  }
  return {
    raw, request,
    get: (url) => request('GET', url),
    post: (url, body = {}) => request('POST', url, body),
    put: (url, body) => request('PUT', url, body),
    patch: (url, body) => request('PATCH', url, body)
  };
}

export async function register(client, email = 'member@test.example', password = 'MemberPass123') {
  const result = await client.post('/api/auth/register', { name: 'Test Member', email, password });
  if (result.status !== 200) throw new Error(`Test registration failed: ${JSON.stringify(result.body)}`);
  return result.body.user;
}

export async function adminClient(app) {
  const client = app.client();
  const result = await client.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (result.status !== 200) throw new Error(`Test admin login failed: ${JSON.stringify(result.body)}`);
  return client;
}
