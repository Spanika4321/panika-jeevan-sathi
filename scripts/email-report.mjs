import fs from 'node:fs';

const recipient =
  fs.readFileSync('.report-recipient', 'utf8').trim();

const apiKey = process.env.RESEND_API_KEY;

if (!recipient) {
  console.error('EMAIL FAIL: recipient missing');
  process.exit(1);
}

if (!apiKey) {
  console.error('EMAIL BLOCKED: RESEND_API_KEY GitHub Secret missing');
  process.exit(2);
}

const now = new Date().toISOString();

const files = [
  'reports/agents/manager-latest.json',
  'reports/agents/pooja-latest.json',
  'reports/agents/priya-latest.json',
  'reports/agents/hindi-employee-report.md',
  'reports/health-report-latest.md'
];

let report = '';

for (const file of files) {
  if (fs.existsSync(file)) {
    report += `\n\n===== ${file} =====\n`;
    report += fs.readFileSync(file, 'utf8');
  }
}

const html = `
<!doctype html>
<html lang="hi">
<body>
<h2>PANIKA JEEVAN SATHI — Employee Report</h2>

<p><b>समय:</b> ${now}</p>

<h3>कर्मचारियों की स्थिति</h3>
<ul>
<li>Guardian: Automated website health check</li>
<li>Pooja: SEO / website diagnosis</li>
<li>Priya: Growth / campaign analysis</li>
<li>Manager: सभी reports coordinate करता है</li>
<li>Recovery: isolated repair verification</li>
</ul>

<h3>Hindi Report</h3>
<pre style="white-space:pre-wrap">${report
  .replaceAll('&','&amp;')
  .replaceAll('<','&lt;')
  .replaceAll('>','&gt;')}</pre>

</body>
</html>
`;

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    from: 'PANIKA JEEVAN SATHI <onboarding@resend.dev>',
    to: [recipient],
    subject: `PANIKA JEEVAN SATHI — Employee Report ${new Date().toLocaleString('en-IN')}`,
    html
  })
});

const text = await response.text();

if (!response.ok) {
  console.error('EMAIL FAIL');
  console.error(text);
  process.exit(1);
}

console.log('REAL EMAIL SENT');
console.log(text);
