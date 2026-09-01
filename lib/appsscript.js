'use strict';
/**
 * PANIKA JEEVAN SATHI — website ↔ maujuda Google Apps Script web app bridge.
 *
 * Env:
 *   APPS_SCRIPT_URL    https://script.google.com/macros/s/.../exec
 *   APPS_SCRIPT_TOKEN  Apps Script Script Property PJS_SHARED_SECRET jaisa hi
 *
 * Agar URL set nahi hai to sab kuch chup-chaap disabled rehta hai — site
 * bilkul pehle jaisi chalti hai. Apps Script down ho to bhi member ka
 * registration/contact kabhi fail nahi hota (fire-and-forget).
 */

const URL_ENV = 'APPS_SCRIPT_URL';
const TOKEN_ENV = 'APPS_SCRIPT_TOKEN';

function configured() {
  return Boolean(process.env[URL_ENV]);
}

function endpoint() {
  return String(process.env[URL_ENV] || '').trim();
}

async function request(payload, { timeoutMs = 6000 } = {}) {
  if (!configured()) return { ok: false, skipped: true, reason: 'not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: process.env[TOKEN_ENV] || '', ...payload }),
      redirect: 'follow',
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text.slice(0, 200) };
    }
    return { ok: res.ok && data && data.ok !== false, status: res.status, data };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Event bhejo, par kabhi throw mat karo aur caller ko rok mat. */
function send(type, data) {
  if (!configured()) return;
  request({ type, data }).then((result) => {
    if (!result.ok && !result.skipped) {
      console.warn(`[apps-script] ${type} log nahi hua: ${result.error || JSON.stringify(result.data)}`);
    }
  });
}

/** Admin health check ke liye. */
async function ping() {
  if (!configured()) return { configured: false };
  const url = `${endpoint()}?action=ping&token=${encodeURIComponent(process.env[TOKEN_ENV] || '')}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = { raw: text.slice(0, 200) };
    }
    return { configured: true, ok: res.ok && data && data.ok !== false, status: res.status, data };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}

module.exports = { configured, send, request, ping };
