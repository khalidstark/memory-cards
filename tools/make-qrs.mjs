#!/usr/bin/env node
/**
 * Generates one QR code per person in data/people.json, plus a printable
 * A4 sheet you can cut up and hand out.
 *
 *   npm i qrcode
 *   node tools/make-qrs.mjs https://your-site.vercel.app
 *
 * Run this LAST, after the site is deployed and the URL is final — printed
 * QR codes can't be edited.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'qr');

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base || !/^https?:\/\//.test(base)) {
  console.error('usage: node tools/make-qrs.mjs https://your-site.vercel.app');
  process.exit(1);
}

let QRCode;
try {
  QRCode = (await import('qrcode')).default;
} catch {
  console.error('qrcode is not installed. Run:  npm i qrcode');
  process.exit(1);
}

const people = JSON.parse(readFileSync(resolve(ROOT, 'data/people.json'), 'utf8'));
const slugs = Object.keys(people).filter((k) => !k.startsWith('_'));

if (!slugs.length) {
  console.error('No people found in data/people.json.');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

// High error correction: the code still scans if a print is smudged, folded,
// or has a small logo dropped in the middle.
const opts = {
  errorCorrectionLevel: 'H',
  margin: 2,
  width: 900,
  color: { dark: '#161616', light: '#ffffff' },
};

const entries = [];

for (const slug of slugs) {
  const url = `${base}/${slug}`;
  const file = resolve(OUT, `${slug}.png`);
  await QRCode.toFile(file, url, opts);
  const entry = people[slug] || {};
  // "ask" cards have no name yet — the person types it when they scan.
  const ask = Boolean(entry.ask);
  const name = ask ? slug : entry.name?.en || slug;
  const dataUrl = await QRCode.toDataURL(url, { ...opts, width: 600 });
  entries.push({ slug, name, url, dataUrl, ask });
  console.log(`${slug.padEnd(20)} ${ask ? '[asks for name]'.padEnd(16) : ''.padEnd(16)} ${url}`);
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const cards = entries
  .map(
    (e) => `      <figure class="tile${e.ask ? ' ask' : ''}">
        <img src="${e.dataUrl}" alt="QR code for ${esc(e.name)}" />
        <figcaption><strong>${esc(e.name)}</strong><small>/${esc(e.slug)}${
          e.ask ? ' · asks for name' : ''
        }</small></figcaption>
      </figure>`,
  )
  .join('\n');

const sheet = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>QR sheet — Connects AI Berlin</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; color: #161616; margin: 0; padding: 12mm; }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  p.sub { margin: 0 0 8mm; color: #555; font-size: 9pt; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
  .tile { margin: 0; border: 1px dashed #bbb; border-radius: 3mm; padding: 4mm; text-align: center; break-inside: avoid; }
  .tile img { width: 100%; height: auto; display: block; }
  figcaption { margin-top: 2mm; line-height: 1.3; }
  figcaption strong { display: block; font-size: 11pt; }
  figcaption small { color: #777; font-size: 7.5pt; }
  .tile.ask { border-color: #c20d0e; }
  .tile.ask figcaption small { color: #c20d0e; }
  .bar { height: 3mm; background: linear-gradient(to right,#161616 0 33.33%,#c20d0e 33.33% 66.66%,#d19428 66.66% 100%); margin-bottom: 6mm; }
  @media print { .noprint { display: none; } }
</style>
</head>
<body>
  <div class="bar"></div>
  <h1>Connects AI — Berlin Workshop</h1>
  <p class="sub">${entries.length} personal card${entries.length === 1 ? '' : 's'} · ${esc(base)}</p>
  <p class="sub noprint">Print this page, then cut along the dashed lines.</p>

  <div class="grid">
${cards}
  </div>
</body>
</html>
`;

writeFileSync(resolve(OUT, 'index.html'), sheet);
console.log(`\n${entries.length} codes written to qr/`);
console.log('Printable sheet: qr/index.html — open it and print.');
