'use strict';
/**
 * REAL WHATSAPP AUTO-REPLY BOT — Option 1 (WhatsApp Web bridge)
 *
 * Aapke apne WhatsApp/WhatsApp Business par chalta hai:
 *   1. Is folder me:   npm install
 *   2. Phir:           npm run wa-web
 *   3. Terminal me QR code aayega → WhatsApp → Linked Devices → Link a Device → QR scan
 *   4. Bas! Ab client ka har message ka AI brain khud reply karega
 *      (हिंदी · Hinglish · বাংলা · Bhojpuri · ଓଡ଼ିଆ — client ki bhasha me)
 *
 * Note: ye unofficial tariqa hai — personal/Chhota business ke liye theek,
 * par WhatsApp ise pasand nahi karta. Official (ban-safe) tariqa ke liye
 * `npm run cloud` dekho (README.md).
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { reply, detectLang, LANG_LABEL } = require('./brain');

const SPEED = Number(process.env.BOT_SPEED || 1200); // human-like delay (ms)
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: { args: ['--no-sandbox'] }
});

client.on('qr', (qr) => {
  console.log('\n📱 WhatsApp kholo → Linked Devices → Link a Device → ye QR scan karo:\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('');
  console.log('✅ BOT READY! Ab client ke messages ka auto-reply chalu.');
  console.log('   Languages: हिंदी · Hinglish · বাংলা · Bhojpuri · ଓଡ଼ିଆ');
  console.log('   Band karne ke liye: Ctrl+C\n');
});

client.on('message', async (msg) => {
  try {
    if (!msg.from || msg.fromMe) return;
    if (msg.from.endsWith('@g.us')) return;              // groups skip
    const body = (msg.body || '').trim();
    if (!body) return;

    const lang = LANG_LABEL[detectLang(body)];
    console.log(`\n📩 [${lang}] ${msg.from}: ${body}`);

    // human-like: typing ka feel
    setTimeout(async () => {
      const answer = reply(body);
      await (msg.getChat ? (await msg.getChat()).sendStateTyping() : null);
      setTimeout(async () => {
        try {
          await msg.reply(answer);
          console.log(`🤖 → ${answer.slice(0, 80)}${answer.length > 80 ? '…' : ''}`);
        } catch (e) {
          console.error('❌ reply fail:', e.message);
        }
      }, Math.min(2500, 400 + answer.length * 12));
    }, SPEED);
  } catch (e) {
    console.error('❌ error:', e.message);
  }
});

client.initialize();
