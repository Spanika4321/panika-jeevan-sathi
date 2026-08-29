'use strict';
/**
 * REAL WHATSAPP AUTO-REPLY BOT — Option 2 (Official Meta Cloud API) ✅ ban-safe
 *
 * Setup (ek baar karna hai, sab FREE):
 *   1. https://developers.facebook.com → My Apps → Create App → type: Business
 *   2. App me "WhatsApp" product add karo → free test number milega
 *   3. WhatsApp → API Setup se PHONE_NUMBER_ID + temporary ACCESS_TOKEN copy karo
 *   4. Webhook ke liye ye server kisi bhi free host par chalao
 *      (Render/Railway/Fly — is repo ka deploy guide DEPLOY.md me hai)
 *   5. Meta App dashboard → WhatsApp → Configuration → Webhook:
 *         Callback URL: https://<aapka-host>/webhook
 *         Verify token: jo niche VERIFY_TOKEN me rakha hai
 *      Subscribe karo "messages" field ko.
 *
 *   Chalane ke liye:
 *      VERIFY_TOKEN=panika PHONE_NUMBER_ID=xxxx ACCESS_TOKEN=xxxx npm run cloud
 *
 * Test number par aap 5 logo ke number add karke unlimited test kar sakte ho — bilkul free.
 */

const http = require('node:http');
const { reply, detectLang, LANG_LABEL } = require('./brain');

const PORT = Number(process.env.PORT || 8090);
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'panika-verify';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
const API_VERSION = 'v21.0';

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function sendWhatsAppText(to, body) {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.warn('⚠️ PHONE_NUMBER_ID / ACCESS_TOKEN set nahi hai — reply console par hi dikhega.');
    return;
  }
  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } })
  });
  if (!res.ok) console.error('❌ send fail:', res.status, await res.text());
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/webhook') {
    if (url.searchParams.get('hub.verify_token') === VERIFY_TOKEN) {
      res.writeHead(200);
      return res.end(url.searchParams.get('hub.challenge'));
    }
    res.writeHead(403);
    return res.end('verify token galat');
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    let payload = '';
    req.on('data', (c) => { payload += c; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(payload || '{}');
        const msg = data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (msg && msg.type === 'text') {
          const from = msg.from;
          const body = (msg.text?.body || '').trim();
          const lang = LANG_LABEL[detectLang(body)];
          const answer = reply(body);
          console.log(`📩 [${lang}] ${from}: ${body}`);
          console.log(`🤖 → ${answer.slice(0, 80)}${answer.length > 80 ? '…' : ''}`);
          await sendWhatsAppText(from, answer);
        }
      } catch (e) {
        console.error('❌ webhook error:', e.message);
      }
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Panika Jeevan Sathi — WhatsApp client bot (Cloud API) is running ✅');
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Cloud API webhook server running: http://localhost:' + PORT + '/webhook');
  console.log('   Languages: हिंदी · Hinglish · বাংলা · Bhojpuri · ଓଡ଼ିଆ\n');
});
