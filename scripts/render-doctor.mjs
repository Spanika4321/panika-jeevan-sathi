const SITE = 'https://panikajeevansathi.onrender.com';

const paths = [
  '/',
  '/login.html',
  '/register',
  '/register.html',
  '/signup',
  '/signup.html',
  '/forgot-password',
  '/forgot-password.html',
  '/reset-password',
  '/reset-password.html',
  '/profile.html',
  '/search.html',
  '/chat.html',
  '/contact.html',
  '/robots.txt',
  '/sitemap.xml'
];

console.log('==============================================');
console.log(' POOJA DOCTOR — RENDER ROUTE DIAGNOSIS');
console.log('==============================================');

const results = [];

for (const p of paths) {
  try {
    const r = await fetch(SITE + p, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    });

    const item = {
      path: p,
      status: r.status,
      location: r.headers.get('location') || null,
      ok: r.ok
    };

    results.push(item);

    console.log(
      `${r.ok ? '✓' : '✗'} ${p} -> ${r.status}` +
      (item.location ? ` -> ${item.location}` : '')
    );
  } catch (e) {
    results.push({
      path: p,
      status: 0,
      ok: false,
      error: e.message
    });

    console.log(`✗ ${p} -> CONNECTION ERROR`);
  }
}

const failed = results.filter(x => !x.ok);

const report = {
  generated_at: new Date().toISOString(),
  site: SITE,
  doctor: 'Pooja',
  total_routes_checked: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
  diagnosis:
    failed.length === 0
      ? 'No route failure detected.'
      : 'Some expected route guesses returned errors. Verify actual application routing before changing code.',
  repair_policy: {
    no_fake_fix: true,
    no_production_deploy: true,
    no_database_change: true,
    no_password_access: true,
    no_private_message_access: true
  }
};

await import('node:fs').then(fs => {
  fs.mkdirSync('reports/agents', { recursive: true });
  fs.writeFileSync(
    'reports/agents/render-doctor-latest.json',
    JSON.stringify(report, null, 2) + '\n'
  );
});

console.log('');
console.log('==============================================');

if (failed.length === 0) {
  console.log('POOJA: ROUTES PASS');
  console.log('MANAGER: NO REPAIR REQUIRED');
  console.log('ALL DONE');
} else {
  console.log(`POOJA: ${failed.length} ROUTE(S) NEED INVESTIGATION`);
  console.log('MANAGER: DO NOT CHANGE PRODUCTION YET');
  console.log('PRIYA: REPORT REQUIRED');
}

console.log('==============================================');
