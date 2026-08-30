const SITE = 'https://panikajeevansathi.onrender.com';

async function get(path) {
  try {
    const r = await fetch(SITE + path, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': 'PANIKA-Employee-Doctor/1.0'
      }
    });

    return {
      status: r.status,
      body: await r.text()
    };
  } catch (e) {
    return {
      status: 0,
      body: '',
      error: e.message
    };
  }
}

const pages = [
  '/',
  '/login.html',
  '/profile.html',
  '/search.html',
  '/contact.html',
  '/reset-password.html'
];

const found = new Set();

console.log('==============================================');
console.log(' POOJA — ACTUAL ROUTE DISCOVERY');
console.log('==============================================');

for (const page of pages) {
  const r = await get(page);

  console.log(
    `${r.status >= 200 && r.status < 400 ? '✓' : '✗'} ${page} -> ${r.status || r.error}`
  );

  if (r.status !== 200) continue;

  const matches = r.body.matchAll(
    /(?:href|action)=["']([^"']+)["']/gi
  );

  for (const match of matches) {
    const route = match[1];

    if (
      route.startsWith('/') &&
      !route.startsWith('//') &&
      !route.startsWith('/api/')
    ) {
      found.add(route.split('#')[0].split('?')[0]);
    }
  }
}

console.log('');
console.log('ACTUAL ROUTES/LINKS DISCOVERED:');

for (const route of [...found].sort()) {
  console.log(`  ${route}`);
}

console.log('');
console.log('==============================================');
console.log('POOJA: ROUTE DISCOVERY COMPLETE');
console.log('404 guessed URLs = NOT automatically treated as bugs');
console.log('MANAGER: VERIFY ACTUAL ROUTES');
console.log('PRIYA: REPORT REAL FAILURES ONLY');
console.log('==============================================');
