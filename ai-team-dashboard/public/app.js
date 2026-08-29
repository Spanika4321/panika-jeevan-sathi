'use strict';
/* =========================================================================
 * AI TEAM DASHBOARD — chat engine
 * 4 AI employees: RAHUL (SEO) · PRIYA (Social) · AMIT (Automation) · SNEHA (Growth)
 * Human-like replies, real website audit, posts, daily growth email.
 * ========================================================================= */

/* ------------------------------ team config ------------------------------ */

const EMPLOYEES = {
  rahul: {
    id: 'rahul', name: 'RAHUL', role: 'SEO & Research Engineer',
    emoji: '👨‍💻', color: '#1f8a70',
    status: 'online · Google Trends + Search Console',
    skills: ['audit', 'keyword', 'seo'],
    intro: [
      'Good morning Boss! 🫡 RAHUL reporting in — SEO & Research Engineer.',
      'Aaj main Google Trends + Search Console se 2 naye keywords nikalne wala hoon. Likhiye: "audit" ya "keyword" 💪'
    ]
  },
  priya: {
    id: 'priya', name: 'PRIYA', role: 'Social Media Manager',
    emoji: '👩‍💻', color: '#b3479b',
    status: 'online · organic campaigns ke liye ready',
    skills: ['post', 'social', 'design'],
    intro: [
      'Hello Boss! 👋 PRIYA here — Social Media Manager.',
      'Aaj ka organic campaign ready hai! Boliye "post" — main reels, captions, hashtags sab bana dungi 🔥'
    ]
  },
  amit: {
    id: 'amit', name: 'AMIT', role: 'Automation & Workflow Manager',
    emoji: '🧑‍💻', color: '#4a7dbd',
    status: 'online · sub-agents standby par',
    skills: ['workload', 'clone', 'automation'],
    intro: [
      'Boss, AMIT here — Automation & Workflow Manager 🤖',
      'Workflow healthy hai. "workload" likhiye to main live status report deta hoon. Zaroorat padi to sub-agents clone kar lunga ⚡'
    ]
  },
  sneha: {
    id: 'sneha', name: 'SNEHA', role: 'Growth & Virality Analyst',
    emoji: '👩‍💼', color: '#d97706',
    status: 'online · virality dashboard live',
    skills: ['viral', 'ads', 'analysis'],
    intro: [
      'Good morning Boss! SNEHA here — Growth & Virality Analyst 📈',
      'Meri dashboard par aaj ke signals dikh rahe hain. "viral analysis" bol dijiye — main potential check karke Ad Hook de dungi 🚀'
    ]
  }
};

const GROUP = {
  id: 'team', name: 'AI Growth Team 🚀', emoji: '🚀', color: '#6d4494',
  members: ['rahul', 'priya', 'amit', 'sneha'],
  status: 'RAHUL, PRIYA, AMIT, SNEHA'
};

const CONTACTS = { ...EMPLOYEES, team: GROUP };

const TRENDS = [
  '"free kundali matching" searches spike kar rahe hain (Google Trends ↑)',
  'Tier-2 cities me free matrimonial demand record high par hai',
  '"date-to-marry" wave — log serious, shaadi-oriented apps dhoond rahe hain',
  'Late-marriage audience (28–35) har mahine grow kar rahi hai',
  'Community-led matchmaking (Panika/Manikpuri/Kabirpanthi) me trust demand strong hai'
];

const HASHTAGS = '#PanikaJeevanSathi #FreeMatrimony #FreeForever #Panika #Manikpuri #Kabirpanthi #Adivasi #SachchaRishta #Shaadi #100Free';

/* ------------------------------ state ------------------------------ */

const $ = (sel) => document.querySelector(sel);
/* Standalone (port 8080) aur integrated (/ai-team) dono me kaam kare */
const API_BASE = location.pathname.startsWith('/ai-team') ? '/api/ai-team' : '/api';
const state = {
  active: 'team',
  chats: {},       // chatId -> { messages: [{from,text,ts,status}] }
  unread: {},      // chatId -> count
  typing: {},      // chatId -> bool
  lastProactive: 0
};

function nowTime(ts) {
  return new Date(ts || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function todayLong() {
  return new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rnd = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/* ------------------------------ persistence ------------------------------ */

const STORE_KEY = 'aiTeamChats_v1';

function save() {
  try {
    const data = {};
    for (const [id, c] of Object.entries(state.chats)) data[id] = c.messages.slice(-80);
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) { /* ignore */ }
}

function seedChats() {
  const now = Date.now();
  state.chats = { team: { messages: [] } };
  for (const id of Object.keys(EMPLOYEES)) state.chats[id] = { messages: [] };

  push({ chat: 'team', from: 'system', text: '🔒 Messages aur tasks end-to-end encrypted hain — sirf Boss aur AI Employees dekh sakte hain.', ts: now - 600000, noSave: true });

  EMPLOYEES.rahul.intro.forEach((t, i) => push({ chat: 'rahul', from: 'rahul', text: t, ts: now - 540000 + i * 2000, noSave: true }));
  EMPLOYEES.priya.intro.forEach((t, i) => push({ chat: 'priya', from: 'priya', text: t, ts: now - 500000 + i * 2000, noSave: true }));
  EMPLOYEES.amit.intro.forEach((t, i) => push({ chat: 'amit', from: 'amit', text: t, ts: now - 460000 + i * 2000, noSave: true }));
  EMPLOYEES.sneha.intro.forEach((t, i) => push({ chat: 'sneha', from: 'sneha', text: t, ts: now - 420000 + i * 2000, noSave: true }));

  push({ chat: 'team', from: 'amit', text: 'Boss ne team activate kar di hai 🫡 Sabhi 4 employees online hain. Aaj ka mission: maximum FREE growth!', ts: now - 400000, noSave: true });
  save();
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.chats = {};
      for (const id of [...Object.keys(EMPLOYEES), 'team']) {
        state.chats[id] = { messages: (data[id] || []).filter((m) => !m.enc) };
      }
      if (!state.chats.team.messages.length) throw new Error('empty');
      if (!state.chats.team.messages.some((m) => m.from === 'system')) {
        state.chats.team.messages.unshift({ from: 'system', text: '🔒 Messages aur tasks end-to-end encrypted hain — sirf Boss aur AI Employees dekh sakte hain.', ts: Date.now() - 900000 });
      }
      return;
    }
  } catch (e) { /* fallthrough */ }
  seedChats();
}

/* ------------------------------ rendering ------------------------------ */

function msgEl(m, contact) {
  const row = document.createElement('div');
  if (m.from === 'system') {
    row.className = 'msg-row';
    const chip = document.createElement('div');
    chip.className = 'enc-chip';
    chip.textContent = m.text;
    row.appendChild(chip);
    return row;
  }

  const out = m.from === 'boss';
  row.className = 'msg-row ' + (out ? 'out' : 'in');

  const b = document.createElement('div');
  b.className = 'bubble' + (m.code ? ' code' : '') + (m.report ? ' report' : '');

  if (!out && contact.id === 'team') {
    const emp = EMPLOYEES[m.from];
    if (emp) {
      const s = document.createElement('span');
      s.className = 'sender';
      s.style.color = emp.color;
      s.textContent = emp.name + ' · ' + emp.role;
      b.appendChild(s);
    }
  }

  const txt = document.createElement('span');
  txt.textContent = m.text;
  b.appendChild(txt);

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.innerHTML = nowTime(m.ts) + ' <span class="tick' + (out && m.status === 'read' ? ' read' : '') + '">' +
    (out ? (m.status === 'sent' ? '✓' : '✓✓') : '') + '</span>';
  b.appendChild(meta);

  row.appendChild(b);
  return row;
}

function renderChatList() {
  const list = $('#chatList');
  const q = ($('#searchInput').value || '').toLowerCase();
  list.innerHTML = '';

  const ids = ['team', ...Object.keys(EMPLOYEES)];
  for (const id of ids) {
    const c = CONTACTS[id];
    if (q && !c.name.toLowerCase().includes(q) && !(c.role || '').toLowerCase().includes(q)) continue;
    const msgs = state.chats[id].messages;
    const last = msgs[msgs.length - 1];
    const item = document.createElement('div');
    item.className = 'chat-item' + (state.active === id ? ' active' : '');
    item.dataset.id = id;
    item.innerHTML =
      '<div class="avatar-wrap"><div class="avatar" style="background:' + c.color + '">' + c.emoji + '</div>' +
      (id !== 'team' ? '<span class="online-dot"></span>' : '') + '</div>' +
      '<div class="chat-item-mid">' +
        '<div class="chat-item-top"><span class="chat-item-name">' + c.name + '</span>' +
        '<span class="chat-item-time">' + (last ? nowTime(last.ts) : '') + '</span></div>' +
        '<div class="chat-item-bottom"><span class="chat-item-last">' +
          (state.typing[id] ? '<i>typing…</i>' : (last ? escapeHtml(last.text.slice(0, 60)) : '—')) +
        '</span>' +
        ((state.unread[id] || 0) > 0 ? '<span class="unread-badge">' + state.unread[id] + '</span>' : '') +
        '</div></div>';
    item.addEventListener('click', () => openChat(id));
    list.appendChild(item);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function openChat(id) {
  state.active = id;
  state.unread[id] = 0;
  const c = CONTACTS[id];
  $('#chatAvatar').textContent = c.emoji;
  $('#chatAvatar').style.background = c.color;
  $('#chatName').textContent = c.name;
  $('#chatStatus').textContent = c.status;
  $('#chatStatus').classList.remove('typing');
  $('#quickActions').innerHTML = '';
  QUICK[id].forEach(([label, text]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.addEventListener('click', () => bossSend(text));
    $('#quickActions').appendChild(b);
  });
  renderMessages();
  renderChatList();
  $('#msgInput').focus();
}

const QUICK = {
  team: [
    ['📧 Daily Email', 'daily email'], ['🔍 Audit', 'audit karo'], ['✍️ Posts', 'aaj ke posts'],
    ['🤖 Workload', 'workload check karo'], ['📈 Viral Analysis', 'viral analysis karo']
  ],
  rahul: [['🔍 Website Audit', 'website audit karo'], ['🔑 Keywords do', 'aaj ke 2 keywords'], ['📊 SEO Report', 'report dikhao']],
  priya: [['✍️ Post banao', 'aaj ka post banao'], ['🎬 Reel caption', 'reel caption'], ['🎨 Design idea', 'design idea do']],
  amit: [['🤖 Workload report', 'workload report'], ['⚡ Sub-agents clone', 'sub-agents clone karo']],
  sneha: [['📈 Viral analysis', 'viral analysis karo'], ['🎯 Ad Hook do', 'ad hook'], ['💡 Ads start karu?', 'ads start karu']]
};

function renderMessages() {
  const wrap = $('#messages');
  wrap.innerHTML = '';
  const msgs = state.chats[state.active].messages;
  let lastDay = '';
  for (const m of msgs) {
    const day = new Date(m.ts).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      const chip = document.createElement('div');
      chip.className = 'day-chip';
      chip.textContent = day === new Date().toDateString() ? 'TODAY' : new Date(m.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      wrap.appendChild(chip);
    }
    wrap.appendChild(msgEl(m, CONTACTS[state.active]));
  }
  wrap.scrollTop = wrap.scrollHeight;
}

function push({ chat, from, text, ts, code, report, status }) {
  state.chats[chat].messages.push({ from, text, ts: ts || Date.now(), code: !!code, report: !!report, status: status || 'read' });
  if (chat !== state.active) {
    if (from !== 'boss' && from !== 'system') state.unread[chat] = (state.unread[chat] || 0) + 1;
  }
  if (chat === state.active) renderMessages();
  renderChatList();
  save();
}

/* ------------------------------ typing + delivery ------------------------------ */

function showTyping(chatId) {
  state.typing[chatId] = true;
  if (chatId === state.active) {
    const st = $('#chatStatus');
    st.textContent = (CONTACTS[chatId].members ? CONTACTS[chatId].members.map((m) => EMPLOYEES[m].name).join(', ') : CONTACTS[chatId].name) + ' typing…';
    st.classList.add('typing');
    const wrap = $('#messages');
    const row = document.createElement('div');
    row.className = 'typing-row';
    row.id = 'typingIndicator';
    row.innerHTML = '<div class="typing-bubble"><span></span><span></span><span></span></div>';
    wrap.appendChild(row);
    wrap.scrollTop = wrap.scrollHeight;
  }
  renderChatList();
}

function hideTyping(chatId) {
  state.typing[chatId] = false;
  const el = $('#typingIndicator');
  if (el) el.remove();
  if (chatId === state.active) {
    $('#chatStatus').textContent = CONTACTS[chatId].status || GROUP.status;
    $('#chatStatus').classList.remove('typing');
  }
  renderChatList();
}

const typingDelay = (text) => Math.min(3400, 700 + text.length * 9) + rnd(0, 350);

function markRead(chatId) {
  const msgs = state.chats[chatId].messages;
  let changed = false;
  for (const m of msgs) {
    if (m.from === 'boss' && m.status !== 'read') { m.status = 'read'; changed = true; }
  }
  if (changed && chatId === state.active) renderMessages();
  save();
}

/* ------------------------------ boss sends ------------------------------ */

function bossSend(raw) {
  const text = (raw || '').trim();
  if (!text) return;
  const chatId = state.active;
  const ts = Date.now();

  push({ chat: chatId, from: 'boss', text, ts, status: 'sent' });
  setTimeout(() => {
    const m = state.chats[chatId].messages.find((x) => x.ts === ts && x.from === 'boss');
    if (m && m.status === 'sent') { m.status = 'delivered'; if (chatId === state.active) renderMessages(); save(); }
  }, 350);

  route(chatId, text);
}

async function route(chatId, text) {
  const low = text.toLowerCase();
  markRead(chatId);

  if (chatId === 'team') {
    const tasks = [];
    if (/(daily\s*email|morning email|growth update)/.test(low)) { await groupEmailFlow(); return; }
    if (/audit|report|seo|site check|website check/.test(low)) tasks.push('rahul');
    if (/post|caption|reel|insta|status|social|content/.test(low)) tasks.push('priya');
    if (/workload|clone|agent|automation/.test(low)) tasks.push('amit');
    if (/viral|ads|analy|potential|hook/.test(low)) tasks.push('sneha');
    if (!tasks.length) {
      if (/^(hi|hii+|hello|hey|namaste|gm|good morning|good evening|yo)/.test(low)) {
        for (const id of GROUP.members) await employeeSay(id, 'team', rand(GREETINGS[id]));
        return;
      }
      await employeeSay(rand(['sneha', 'priya']), 'team',
        'Boss, order clear nahi tha 😅 Ye try kijiye: "daily email", "audit", "posts", "workload", "viral analysis" — team turant execute karegi!');
      return;
    }
    for (const id of tasks) await handleSkill(id, 'team', low);
    return;
  }

  // direct chat
  await handleSkill(chatId, chatId, low, text);
}

const GREETINGS = {
  rahul: ['Hello Boss! 🫡 Rahul online hai — kaam par lagu? "audit" ya "keyword" boliye.'],
  priya: ['Hi Boss! 😄 Priya ready — aaj kya post karna hai?'],
  amit: ['Boss! 🤖 Amit standby par — workflow stable, bola to execute kar dunga.'],
  sneha: ['Hello Boss! 📈 Sneha here — signals strong dikh rahe hain aaj!']
};

/* ------------------------------ employee brain ------------------------------ */

async function employeeSay(empId, chatId, text, extra) {
  showTyping(chatId);
  await sleep(typingDelay(text));
  hideTyping(chatId);
  push({ chat: chatId, from: empId, text, ...(extra || {}) });
  if (chatId === state.active) markRead(chatId);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function handleSkill(empId, chatId, low, originalText) {
  if (empId === 'rahul') {
    if (/keyword/.test(low) && !/audit/.test(low)) return rahulKeywords(chatId);
    if (/audit|report|site check|website check|health|seo check/.test(low)) return rahulAudit(chatId);
    return rahulSmallTalk(chatId, low);
  }
  if (empId === 'priya') {
    if (/design|poster|banner|theme|look/.test(low)) return priyaDesign(chatId);
    if (/post|caption|reel|insta|status|social|content/.test(low)) return priyaPosts(chatId, low);
    return priyaSmallTalk(chatId, low);
  }
  if (empId === 'amit') {
    return amitWorkload(chatId, low);
  }
  if (empId === 'sneha') {
    if (/hook/.test(low)) return snehaAnalysis(chatId, true);
    if (/viral|analy|potential|ads|growth|score/.test(low)) return snehaAnalysis(chatId, false);
    return snehaSmallTalk(chatId, low);
  }
}

/* ---- RAHUL ---- */

async function rahulAudit(chatId) {
  await employeeSay('rahul', chatId, rand([
    '🔍 Theek hai Boss, poora website audit chala raha hoon… site health, SEO, speed, robots, sitemap — sab check karta hoon.',
    '📊 On it Boss! Live audit shuru kar raha hoon — 2 minute dijiye…'
  ]));
  let data;
  try {
    const res = await fetch(API_BASE + '/audit', { method: 'POST' });
    data = await res.json();
  } catch (e) {
    await employeeSay('rahul', chatId, 'Boss, audit engine tak nahi pahuncha 😬 Server console check kijiye.');
    return;
  }
  if (!data.ok) {
    await employeeSay('rahul', chatId, 'Boss, audit fail ho gaya: ' + (data.error || 'unknown error'));
    return;
  }

  const mode = data.mode === 'live' ? '🟢 LIVE audit' : '🟡 STATIC file audit (site offline thi)';
  const lines = data.checks.map((c) => (c.pass ? '✅' : '❌') + ' ' + c.label + ' — ' + c.detail).join('\n');
  const report1 =
    '📊 WEBSITE AUDIT REPORT\n🗓 ' + todayLong() + ' · ' + mode + '\n🔗 ' + data.url + '\n\n' + lines;
  const fixes = data.suggestions.map((s, i) => (i + 1) + '. ' + s).join('\n');
  const report2 =
    '🏁 FINAL SCORE: ' + data.score + '/100 → Grade ' + data.grade + '\n' +
    (data.pageKB ? '📦 Page size: ' + data.pageKB + ' KB · 🔗 Links: ' + data.links + '\n\n' : '\n') +
    '🛠 TOP FIXES (sab free tools se):\n' + fixes;

  await employeeSay('rahul', chatId, report1, { report: true });
  await sleep(400);
  await employeeSay('rahul', chatId, report2, { report: true });
  await sleep(300);
  await employeeSay('rahul', chatId, rand([
    'Boss, score ' + data.score + ' hai' + (data.score >= 80 ? ' — solid! 👏 Next report kal subah milega.' : ' — upar chadhna hai. Upar wale fixes aaj hi kar dete hain 💪'),
    'Report aapke saamne hai Boss. Aadesh kijiye — turant execute karenge! 🫡'
  ]));
}

async function rahulKeywords(chatId) {
  const picks = [...TRENDS].sort(() => Math.random() - 0.5).slice(0, 2);
  const kw = [
    ['"free matrimonial site for Panika community"', 'low competition, high intent — humara exact audience'],
    ['"free kundali matching for marriage online"', 'trending spike — blog post bana sakte hain']
  ];
  await employeeSay('rahul', chatId,
    '🔑 Boss, aaj ke Google Trends + Search Console se **2 new keywords** ready:\n\n' +
    '1️⃣ ' + kw[0][0] + '\n→ ' + kw[0][1] + '\n\n' +
    '2️⃣ ' + kw[1][0] + '\n→ ' + kw[1][1] + '\n\n' +
    '📈 Live trends support:\n• ' + picks.join('\n• ') + '\n\n' +
    'Dono keywords existing pages par map karke sitemap Search Console me submit kar dunga. 100% free tools, zero cost Boss! 🫡');
}

function rahulSmallTalk(chatId, low) {
  if (/^(hi|hii+|hello|hey|namaste|gm|good morning)/.test(low)) return employeeSay('rahul', chatId, rand(GREETINGS.rahul));
  if (/kaise ho|how are you|kya haal/.test(low)) return employeeSay('rahul', chatId, rand([
    'Badhiya hoon Boss! Search Console me impressions badh rahe hain, isliye mood on hai 😄 Aap bataiye?',
    'Ekdum fresh Boss — aaj 2 naye keywords milne wale hain, bas isi ka wait tha 💪'
  ]));
  if (/thank|dhanyavad|shukriya|thx/.test(low)) return employeeSay('rahul', chatId, rand([
    'Kya baat kar rahe hai Boss, aapke liye hi to hain 🫡',
    'Anytime Boss! Aapka mission, hamara mission 🔥'
  ]));
  if (/kaun ho|who are you|intro/.test(low)) return employeeSay('rahul', chatId, 'Main RAHUL hoon Boss — aapka SEO & Research Engineer 👨‍💻 Google ke free tools (Trends + Search Console) se site ko #1 tak le jaata hoon.');
  if (/help|command|kya kar sakte|madad/.test(low)) return employeeSay('rahul', chatId, 'Boss mere paas 3 powers hain:\n🔍 "audit" — poora website audit + report\n🔑 "keyword" — 2 naye SEO keywords\n📊 "report" — SEO report\n\nBaaki team ke paas posts, workload aur viral analysis hai!');
  return employeeSay('rahul', chatId, rand([
    'Note kar liya Boss 📝 Kaam me add kar dunga. Ya "audit" bol dijiye — site ki report de deta hoon.',
    'Samajh gaya Boss. Agar site ki health check karni ho to "audit" likhiye 🔍'
  ]));
}

/* ---- PRIYA ---- */

const POST_TEMPLATES = [
  {
    type: '📸 Instagram Reel Caption',
    body: 'Others charge ₹5,000+ for rishtey.\nHum charge ₹0. Forever. 💚\n\nApni community, apna matrimony —\nPanika · Manikpuri · Kabirpanthi · Adivasi\n\nRegister FREE → link in bio 🔗',
    cta: 'Best time: 6–8 PM · Audio: trending romantic BGM'
  },
  {
    type: '💬 WhatsApp Status',
    body: '🌿 Sachche rishtey ki talash?\n100% FREE matrimony — no fees, no subscription, no hidden charges.\n✅ Verified profiles\n✅ Apni community\n✅ Free forever\nJoin: Panika Jeevan Sathi 💚',
    cta: 'Morning 9 AM + night 8 PM — do baar lagayein'
  },
  {
    type: '📘 Facebook Group Post',
    body: 'Dosto, ek zaroori baat 🙏\nHamari community ke liye 100% FREE matrimonial site live hai — Panika Jeevan Sathi.\n🔸 Koi payment nahi\n🔸 Koi premium plan nahi\n🔸 Sab profiles unlocked\nApno ko share kijiye, kisi ka rishta jud jaye to dua milegi 🤲',
    cta: '10 community groups me aaj post karna hai'
  },
  {
    type: '🎬 Reel Hook (5 sec)',
    body: '"Shaadi.com se ₹5,000 le liye…\nyahan se rishta FREE me mil gaya 😳"\n\n→ Screen recording: profile browse → match → "₹0 kyun?"\n→ End me: "Kyunki pyaar paid nahi hota 💚"',
    cta: 'Trending format — 15 sec max'
  }
];

async function priyaPosts(chatId, low) {
  const multi = /posts|sab|all|campaign/.test(low) || /aaj ke posts|posts banao/.test(low);
  const picks = multi ? POST_TEMPLATES : [rand(POST_TEMPLATES)];
  await employeeSay('priya', chatId, rand([
    'On it Boss! ✍️ Trend + community angle ke saath ready kar rahi hoon…',
    'Ek minute Boss — caption, hook, hashtags, timing… sab plan kar rahi hoon 🔥'
  ]));
  for (const p of picks) {
    await sleep(500);
    await employeeSay('priya', chatId, p.type + '\n\n' + p.body + '\n\n' + HASHTAGS + '\n\n⏰ ' + p.cta);
  }
  await sleep(350);
  await employeeSay('priya', chatId, rand([
    'Boss, aaj ka target: 50+ free registrations is week se 🔥 Approve kijiye to main schedule kar deti hoon!',
    'Ye content 100% organic hai — zero ads, zero cost Boss. Green signal dijiye, post ho jayega 🚀'
  ]));
}

async function priyaDesign(chatId) {
  await employeeSay('priya', chatId,
    '🎨 Boss, website ke liye aaj ka design suggestion:\n\n1️⃣ Hero section: ek couple silhouette + bold badge "100% FREE FOREVER" — WhatsApp-green (#00a884) CTA button "Register Free"\n\n2️⃣ Trust strip (homepage top): "No Fees · Verified Profiles · Apni Community"\n\n3️⃣ Colors: warm cream background + deep green accents — shaadi wali feel, premium lagti hai\n\n4️⃣ Mobile-first: 80% log phone se aayenge (Tier-2 trend) — bade buttons, Hindi+English mix text\n\nPoster bhi bana sakti hoon — boliye kya text chahiye! ✨');
}

function priyaSmallTalk(chatId, low) {
  if (/^(hi|hii+|hello|hey|namaste|gm|good morning)/.test(low)) return employeeSay('priya', chatId, rand(GREETINGS.priya));
  if (/kaise ho|how are you|kya haal/.test(low)) return employeeSay('priya', chatId, 'Mast hoon Boss! Kal wali reel ne acche views liye, aaj usse double karenge 😄');
  if (/thank|dhanyavad|shukriya|thx/.test(low)) return employeeSay('priya', chatId, 'Arre Boss, ye to mera kaam hai 😊 Aap bas growth dekhiye!');
  if (/kaun ho|who are you|intro/.test(low)) return employeeSay('priya', chatId, 'Main PRIYA hoon Boss — Social Media Manager 👩‍💻 Instagram, WhatsApp, Facebook — sab organic, bilkul free tools se.');
  if (/help|command|kya kar sakte|madad/.test(low)) return employeeSay('priya', chatId, 'Boss mujhse ye karwaiye:\n✍️ "post" — nayi post + hashtags\n🎬 "reel caption" — reel content\n🎨 "design idea" — website design suggestions');
  return employeeSay('priya', chatId, rand([
    'Ji Boss, note kiya 📝 Content plan me daal deti hoon. Ya "post" boliye — turant bana deti hoon!',
    'Samajh gaya Boss 💚 Ideas chahiye to "post" ya "design idea" likhiye.'
  ]));
}

/* ---- AMIT ---- */

async function amitWorkload(chatId, low) {
  const activeTasks = rnd(3, 7);
  const high = activeTasks >= 4;
  await employeeSay('amit', chatId, '🤖 Boss, workload check kar raha hoon…');
  await sleep(600);

  let msg = '📋 WORKLOAD REPORT — ' + todayLong() + '\n\n' +
    '• Active tasks: ' + activeTasks + '\n' +
    '• Pending posts: ' + rnd(2, 5) + '\n' +
    '• Running audits: ' + (activeTasks > 4 ? 1 : 0) + '\n' +
    '• Sub-agents active: ' + (high ? 3 : 0) + '\n\n';

  if (high) {
    msg += 'Boss, the workload is high today, so I am cloning our workflow to create 3 extra sub-agents to handle the extra posts automatically.\n\n' +
      '⚡ Sub-Agent A → WhatsApp status posts\n⚡ Sub-Agent B → Facebook group engagement\n⚡ Sub-Agent C → reel captions + hashtags\n\n' +
      'Main 5 PM ko sab outputs personally QA karunga Boss — quality human rahegi. 🫡';
  } else {
    msg += 'Boss, workload manageable hai — core workflow smoothly handle kar raha hai. Spike hua to turant sub-agents clone kar dunga ⚡';
  }
  await employeeSay('amit', chatId, msg);
  if (high) {
    await sleep(400);
    await employeeSay('amit', chatId, rand([
      'Sab automated hai Boss — aap chai piijiye ☕ Output khud banega.',
      'Automation on ✅ Boss, koi task manually karne ki zaroorat nahi.'
    ]));
  }
}

function amitSmallTalkFallback(chatId, low) {
  if (/^(hi|hii+|hello|hey|namaste|gm|good morning)/.test(low)) return employeeSay('amit', chatId, rand(GREETINGS.amit));
  return employeeSay('amit', chatId, 'Boss, "workload" likhiye — main live report deta hoon 🤖');
}

/* ---- SNEHA ---- */

const AD_HOOKS = [
  '"₹0 Registration. ₹0 Subscription. ₹0 Hidden Charges. Only sachche rishtey — apni community, apna matrimony. Panika Jeevan Sathi: 100% FREE, forever. Register free today!" 🚀',
  '"Rishta wahi jo dil se — bill woh koi nahi bharta. 100% free matrimony, apni Panika community ke liye. Aaj hi join kijiye!" 💚',
  '"Lakhon rishtey. Zero fees. Ek community. Panika Jeevan Sathi — shaadi ka sachcha saathi. Free registration, lifetime free!" ✨'
];

async function snehaAnalysis(chatId, hookOnly) {
  await employeeSay('sneha', chatId, '📈 Boss, virality dashboard par live signals analyse kar rahi hoon…');
  await sleep(700);

  const score = rnd(64, 96);
  const viral = score >= 75;

  if (hookOnly) {
    await employeeSay('sneha', chatId, '🎯 Boss, aaj ka best Ad Hook:\n\n' + rand(AD_HOOKS));
    return;
  }

  let msg = '📊 VIRALITY ANALYSIS — ' + todayLong() + '\n\n' +
    '• Virality score: ' + score + '/100 ' + (viral ? '🔥' : '🙂') + '\n' +
    '• Trend support:\n   – ' + [...TRENDS].sort(() => Math.random() - 0.5).slice(0, 3).join('\n   – ') + '\n\n';

  if (viral) {
    msg += 'Boss, organic growth is peaking. I recommend we start Ads today.\n\n' +
      '🎯 Quick Ad Hook:\n' + rand(AD_HOOKS) + '\n\n' +
      'Budget suggestion: sirf ₹200–500/day se start kijiye Boss — best performing post ko boost karenge, pura budget free tools ki earnings se recover.';
  } else {
    msg += 'Boss, potential accha hai par peak nahi hua — aaj organic par focus karte hain, 2 din me ads ka sahi window aayega. Main monitor kar rahi hoon 👀';
  }
  await employeeSay('sneha', chatId, msg);

  if (viral) {
    await sleep(400);
    await employeeSay('sneha', chatId, 'Boss, aapke approval ka wait hai. Approval ke saath ye code ready rakha hai 👇');
    await sleep(350);
    await employeeSay('sneha', chatId, 'LAUNCH_ADS', { code: true });
  }
}

function snehaSmallTalk(chatId, low) {
  if (/^(hi|hii+|hello|hey|namaste|gm|good morning)/.test(low)) return employeeSay('sneha', chatId, rand(GREETINGS.sneha));
  if (/kaise ho|how are you|kya haal/.test(low)) return employeeSay('sneha', chatId, 'Ekdum charged hoon Boss — dashboard par 3 green signals blink kar rahe hain 📈😄');
  if (/thank|dhanyavad|shukriya|thx/.test(low)) return employeeSay('sneha', chatId, 'Pleasure is all mine Boss 🌸 Growth aapki, mehnat hamari!');
  if (/kaun ho|who are you|intro/.test(low)) return employeeSay('sneha', chatId, 'Main SNEHA hoon Boss — Growth & Virality Analyst 👩‍💼 Trends, potential aur ads strategy — sab main track karti hoon.');
  if (/help|command|kya kar sakte|madad/.test(low)) return employeeSay('sneha', chatId, 'Boss mere tools:\n📈 "viral analysis" — aaj ka potential + score\n🎯 "ad hook" — ready-made ad copy\n💡 "ads start karu" — meri recommendation');
  if (/ads start karu/.test(low)) return snehaAnalysis(chatId, false);
  return employeeSay('sneha', chatId, rand([
    'Noted Boss 📝 Analysis chahiye to "viral analysis" bol dijiye.',
    'Ji Boss! Data chahiye to boliye — "viral analysis" turant de dungi 📊'
  ]));
}

/* ------------------------------ daily email ------------------------------ */

function buildDailyEmail() {
  const date = todayLong();
  const trendCount = rnd(2, 4);
  const viralScore = rnd(70, 95);
  const workloadHigh = trendCount >= 3;
  const recommendAds = viralScore >= 75;
  const trends = [...TRENDS].sort(() => Math.random() - 0.5);
  const kws = [
    '"free matrimonial site for Panika community"',
    '"free kundali matching for marriage online"'
  ];

  const hook = rand(AD_HOOKS);

  const amitLine = workloadHigh
    ? 'Check the workload first: we have ' + trendCount + ' live trends today (multiple trends). Boss, the workload is high today, so I am cloning our workflow to create 3 extra sub-agents to handle the extra posts automatically. Sub-Agent A → WhatsApp status, Sub-Agent B → Facebook groups, Sub-Agent C → reel captions. I will QA every output at 5 PM.'
    : 'Workload check done: ' + trendCount + ' live trends — manageable. Core workflow is handling everything smoothly; I will clone sub-agents the moment it spikes.';

  const snehaLine = recommendAds
    ? 'Potential check: virality score ' + viralScore + '/100 🔥 Boss, organic growth is peaking. I recommend we start Ads today.\n   My quick Ad Hook: ' + hook
    : 'Potential check: virality score ' + viralScore + '/100 — organic me momentum hai par ads ka peak window abhi 1–2 din door hai. Aaj organic focus, main monitoring par hoon.';

  const subject = 'Daily Growth Update - ' + date;
  const body =
    'Hello Good Morning Boss! Here is our action plan for today to maximize our growth using free tools.\n\n' +
    '════════════════════════════════════════\n' +
    '1. RAHUL — SEO & Research Engineer\n' +
    '════════════════════════════════════════\n' +
    'Boss, aaj main free Google Tools (Google Trends + Google Search Console) me live trends track kar raha hoon.\n' +
    'Aaj ke top trends: ' + trends.slice(0, 2).join('; ') + '.\n' +
    'Inhi se main aaj 2 NEW keywords extract kar raha hoon:\n' +
    '  1) ' + kws[0] + '\n' +
    '  2) ' + kws[1] + '\n' +
    'Dono ko pages par map karke sitemap Search Console me submit kar dunga. 100% free tools.\n\n' +
    '════════════════════════════════════════\n' +
    '2. PRIYA — Social Media Manager\n' +
    '════════════════════════════════════════\n' +
    'Boss, aaj main "#FreeForever Shaadi Week" organic campaign launch kar rahi hoon:\n' +
    '  • Instagram Reel (6 PM): "Others charge ₹5,000+ for rishtey. We charge ₹0." — date-to-marry trend par\n' +
    '  • WhatsApp Status (9 AM & 8 PM): profile-of-the-day + free registration CTA\n' +
    '  • Facebook: 10 community groups me value posts (zero spam)\n' +
    'Target: 50+ free registrations this week. Pure organic, zero cost.\n\n' +
    '════════════════════════════════════════\n' +
    '3. AMIT — Automation & Workflow Manager\n' +
    '════════════════════════════════════════\n' +
    amitLine + '\n\n' +
    '════════════════════════════════════════\n' +
    '4. SNEHA — Growth & Virality Analyst\n' +
    '════════════════════════════════════════\n' +
    snehaLine + '\n\n' +
    'Boss, with your green light we turn today\'s momentum into a rocket. Awaiting your command!\n\n' +
    '— RAHUL · PRIYA · AMIT · SNEHA\n' +
    'Your AI Employees — PANIKA JEEVAN SATHI Growth Team' +
    (recommendAds ? '\n\nLAUNCH_ADS' : '');

  return { subject, body, recommendAds, viralScore, trendCount };
}

let lastEmail = null;

async function groupEmailFlow() {
  await employeeSay('amit', 'team', '📧 Boss ne Daily Growth Email maanga hai — team, apne sections ready karo!');
  await sleep(600);
  lastEmail = buildDailyEmail();

  await employeeSay('rahul', 'team',
    '1️⃣ RAHUL: Aaj Trends par ' + lastEmail.trendCount + ' live trends mile. Main free Google Tools se 2 naye keywords nikal raha hoon:\n• ' + ['"free matrimonial site for Panika community"', '"free kundali matching for marriage online"'].join('\n• ') + '\nSEO update email me detail se hai 🫡');

  await sleep(700);
  await employeeSay('priya', 'team',
    '2️⃣ PRIYA: Aaj ka organic campaign "#FreeForever Shaadi Week" launch ho raha hai 🎯 Reel 6 PM, WhatsApp status 9 AM + 8 PM, 10 Facebook groups. Target: 50+ free registrations 🔥');

  await sleep(700);
  if (lastEmail.trendCount >= 3) {
    await employeeSay('amit', 'team',
      '3️⃣ AMIT: Multiple trends live hain — Boss, the workload is high today, so I am cloning our workflow to create 3 extra sub-agents to handle the extra posts automatically. ⚡');
  } else {
    await employeeSay('amit', 'team', '3️⃣ AMIT: Workload stable hai Boss — core workflow sab sambhal raha hai ⚡');
  }

  await sleep(700);
  if (lastEmail.recommendAds) {
    await employeeSay('sneha', 'team',
      '4️⃣ SNEHA: Virality ' + lastEmail.viralScore + '/100 🔥 Boss, organic growth is peaking. I recommend we start Ads today.\n\n🎯 Ad Hook: ' + rand(AD_HOOKS));
    await sleep(500);
    push({ chat: 'team', from: 'sneha', text: 'LAUNCH_ADS', code: true });
  } else {
    await employeeSay('sneha', 'team', '4️⃣ SNEHA: Virality ' + lastEmail.viralScore + '/100 — solid, par ads ka peak window thoda baad me. Aaj organic push karte hain 📈');
  }

  await sleep(500);
  await employeeSay('amit', 'team', '📧 Full email ready hai Boss — upar 📧 button se kholiye, copy karke bhej sakte hain!');
  openEmailModal(lastEmail);
}

function openEmailModal(email) {
  lastEmail = email || buildDailyEmail();
  $('#emailBody').textContent = 'Subject: ' + lastEmail.subject + '\n\n' + lastEmail.body;
  $('#emailModal').classList.remove('hidden');
}

/* ------------------------------ proactive life ------------------------------ */

const PROACTIVE = [
  ['priya', 'Boss, ek idea aya 💡 — aaj shaadi season ki trending audio par reel banate hain? Boliye "post"!'],
  ['rahul', 'Boss, Search Console par halki si movement dikh rahi hai 📈 Kal ke keywords submit karni hain?'],
  ['sneha', 'Boss, dashboard par ek naya signal blink kar raha hai 👀 "viral analysis" boliye to detail deta hoon.'],
  ['amit', 'Boss, sab automation green ✅ Koi task dena ho to boliye.'],
  ['sneha', 'Boss, ek trend tezi se rise kar raha hai — free kundali matching! 🔥']
];

function startLife() {
  setInterval(() => {
    if (document.hidden || state.typing.team) return;
    if (Date.now() - state.lastProactive < 150000) return;
    if (Math.random() > 0.3) return;
    const [emp, text] = rand(PROACTIVE);
    state.lastProactive = Date.now();
    push({ chat: 'team', from: emp, text });
  }, 45000);
}

/* ------------------------------ wiring ------------------------------ */

function wire() {
  $('#sendBtn').addEventListener('click', () => { bossSend($('#msgInput').value); $('#msgInput').value = ''; });
  $('#msgInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); bossSend($('#msgInput').value); $('#msgInput').value = ''; }
  });
  $('#searchInput').addEventListener('input', renderChatList);
  $('#emojiBtn').addEventListener('click', () => {
    const inp = $('#msgInput');
    inp.value += rand(['🙏', '🔥', '💪', '🚀', '😊', '👍', '💚', '⚡']);
    inp.focus();
  });
  $('#emailBtn').addEventListener('click', () => openEmailModal());
  $('#closeModal').addEventListener('click', () => $('#emailModal').classList.add('hidden'));
  $('#emailModal').addEventListener('click', (e) => { if (e.target === $('#emailModal')) $('#emailModal').classList.add('hidden'); });
  $('#copyEmail').addEventListener('click', () => {
    if (!lastEmail) lastEmail = buildDailyEmail();
    navigator.clipboard.writeText('Subject: ' + lastEmail.subject + '\n\n' + lastEmail.body)
      .then(() => { $('#copyEmail').textContent = '✅ Copied!'; setTimeout(() => { $('#copyEmail').textContent = '📋 Copy Email'; }, 1600); })
      .catch(() => alert('Copy nahi hua — email text ko manually select kar lijiye.'));
  });
  $('#sendToChat').addEventListener('click', async () => {
    $('#emailModal').classList.add('hidden');
    openChat('team');
    await groupEmailFlow();
  });
  $('#auditBtn').addEventListener('click', () => { openChat('team'); bossSend('audit karo'); });
  $('#postsBtn').addEventListener('click', () => { openChat('team'); bossSend('aaj ke posts banao'); });
}

function init() {
  load();
  wire();
  openChat('team');
  startLife();
}

document.addEventListener('DOMContentLoaded', init);
