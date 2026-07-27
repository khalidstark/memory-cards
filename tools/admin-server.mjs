#!/usr/bin/env node
/**
 * Local-only admin server.  `npm run admin`
 *
 * Serves the site exactly the way Vercel will (so the card preview is the real
 * thing, not an approximation) and adds three endpoints the admin page needs:
 *
 *   PUT  /api/people        save data/people.json
 *   GET  /api/qr?slug=&base=  download one QR code as a PNG
 *   GET  /api/health        used by the page to confirm it's talking to us
 *
 * It binds to 127.0.0.1 only. Nothing here is reachable from the network, and
 * admin.html is excluded from deployment by .vercelignore — the live site has
 * no admin page and no write endpoint at all.
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PEOPLE = join(ROOT, 'data/people.json');
const PORT = Number(process.env.PORT) || 4174;

let QRCode;
try {
  QRCode = (await import('qrcode')).default;
} catch {
  console.error('qrcode is not installed. Run:  npm i qrcode');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};
const json = (res, code, obj) =>
  send(res, code, JSON.stringify(obj), { 'Content-Type': MIME['.json'] });

function readBody(req, limit = 5_000_000) {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        fail(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const RESERVED = new Set(['index', 'admin', 'assets', 'js', 'data', 'vendor', 'qr', 'api', 'card']);

/** Rejects anything that would produce an unreachable or colliding URL. */
function validate(people) {
  if (!people || typeof people !== 'object' || Array.isArray(people)) return 'not an object';
  for (const [slug, entry] of Object.entries(people)) {
    if (slug.startsWith('_')) continue; // notes/readme keys
    if (!SLUG_RE.test(slug)) return `bad slug: "${slug}" (lowercase letters, numbers, dashes)`;
    if (RESERVED.has(slug)) return `"${slug}" is a reserved word`;
    if (!entry || typeof entry !== 'object') return `"${slug}" is not an object`;
    // Every card carries its own message now — an ask card without one would
    // render blank after the person types their name.
    if (!entry.front || !entry.back) return `"${slug}" needs front and back text`;
    if (entry.workshops) return `"${slug}" uses the old "workshops" format — reload the admin page (⌘R)`;
    if ('reply' in entry && typeof entry.reply !== 'boolean') return `"${slug}" has a bad reply flag`;
    if (entry.decoration && typeof entry.decoration !== 'object') return `"${slug}" has a bad decoration`;
  }
  return null;
}

/**
 * Bumped whenever the shape of people.json changes. The admin page sends the
 * version it was built with; a mismatch means the browser is running stale
 * JavaScript from before a change, and saving would write the old format over
 * good data. That happened once — hence this check.
 */
const SCHEMA = 4;

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, schema: SCHEMA });

  // Is this slug actually published yet? Saving is not the same as deploying,
  // and a QR code for an undeployed card scans to "not assigned yet".
  if (url.pathname === '/api/check' && req.method === 'GET') {
    const slug = (url.searchParams.get('slug') || '').trim();
    const base = (url.searchParams.get('base') || '').trim().replace(/\/+$/, '');
    if (!SLUG_RE.test(slug) || !/^https?:\/\//.test(base)) {
      return json(res, 400, { error: 'bad slug or base' });
    }
    try {
      const r = await fetch(`${base}/data/people.json`, { cache: 'no-store' });
      if (!r.ok) return json(res, 200, { reachable: false, live: false });
      const remote = await r.json();
      const entry = remote[slug];
      const same = JSON.stringify(entry) === JSON.stringify(JSON.parse(await readFile(PEOPLE, 'utf8'))[slug]);
      return json(res, 200, { reachable: true, live: Boolean(entry), current: same });
    } catch {
      return json(res, 200, { reachable: false, live: false });
    }
  }

  if (url.pathname === '/api/people' && req.method === 'PUT') {
    if (Number(url.searchParams.get('schema')) !== SCHEMA) {
      return json(res, 409, {
        error: 'This admin page is out of date — reload it (⌘R) before saving, or it will overwrite your cards with the old format.',
      });
    }
    let incoming;
    try {
      incoming = JSON.parse(await readBody(req));
    } catch (e) {
      return json(res, 400, { error: `Could not read the data: ${e.message}` });
    }
    const problem = validate(incoming);
    if (problem) return json(res, 400, { error: problem });

    // Write to a temp file then rename, so a crash mid-write can't leave you
    // with a half-saved roster.
    const tmp = `${PEOPLE}.tmp`;
    const text = `${JSON.stringify(incoming, null, 2)}\n`;
    await writeFile(tmp, text, 'utf8');
    await writeFile(PEOPLE, text, 'utf8');
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(tmp);
    } catch {}
    const count = Object.keys(incoming).filter((k) => !k.startsWith('_')).length;
    console.log(`saved data/people.json — ${count} ${count === 1 ? 'card' : 'cards'}`);
    return json(res, 200, { ok: true, count });
  }

  // Replies people sent back, as pulled into the repo by `git pull`.
  // Read-only, and local-only — this server never runs anywhere but the laptop.
  if (url.pathname === '/api/replies' && req.method === 'GET') {
    const dir = join(ROOT, 'replies');
    if (!existsSync(dir)) return json(res, 200, { replies: [] });
    const { readdir } = await import('node:fs/promises');
    const names = (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.'));
    const replies = [];
    for (const name of names) {
      try {
        const data = JSON.parse(await readFile(join(dir, name), 'utf8'));
        if (data && data.message) replies.push({ file: name, ...data });
      } catch {
        // A malformed file shouldn't hide every other reply.
        console.warn(`skipped unreadable reply: ${name}`);
      }
    }
    replies.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    return json(res, 200, { replies });
  }

  // Decoration layers for Khalid's own cards. Written as ordinary assets so
  // they deploy with the site; people.json only stores the filename.
  if (url.pathname === '/api/decoration' && req.method === 'PUT') {
    let body;
    try {
      body = JSON.parse(await readBody(req, 2_000_000));
    } catch (e) {
      return json(res, 400, { error: `Could not read the image: ${e.message}` });
    }
    const { slug, side, png } = body;
    if (!SLUG_RE.test(String(slug || '')) || !['front', 'back'].includes(side)) {
      return json(res, 400, { error: 'bad slug or side' });
    }
    const dir = join(ROOT, 'assets/decorations');
    const { mkdir, unlink } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    const name = `${slug}-${side}.png`;

    if (!png) {
      // Clearing a side removes the file rather than leaving a stale one behind.
      await unlink(join(dir, name)).catch(() => {});
      return json(res, 200, { ok: true, file: null });
    }
    const prefix = 'data:image/png;base64,';
    if (typeof png !== 'string' || !png.startsWith(prefix)) {
      return json(res, 400, { error: 'expected a PNG data URL' });
    }
    await writeFile(join(dir, name), Buffer.from(png.slice(prefix.length), 'base64'));
    console.log(`saved assets/decorations/${name}`);
    return json(res, 200, { ok: true, file: name });
  }

  if (url.pathname === '/api/qr' && req.method === 'GET') {
    const slug = (url.searchParams.get('slug') || '').trim();
    const base = (url.searchParams.get('base') || '').trim().replace(/\/+$/, '');
    if (!SLUG_RE.test(slug)) return json(res, 400, { error: 'bad slug' });
    if (!/^https?:\/\//.test(base)) return json(res, 400, { error: 'base must start with http(s)://' });
    // High error correction so a smudged or folded print still scans.
    const png = await QRCode.toBuffer(`${base}/${slug}`, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 1200,
      color: { dark: '#161616', light: '#ffffff' },
    });
    return send(res, 200, png, {
      'Content-Type': MIME['.png'],
      'Content-Disposition': `attachment; filename="${slug}-qr.png"`,
    });
  }

  return json(res, 404, { error: 'no such endpoint' });
}

function resolveFile(pathname) {
  // normalize() collapses any ../ before we ever touch the filesystem.
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '');
  const target = join(ROOT, rel);
  if (!target.startsWith(ROOT)) return null; // escaped the project directory
  if (rel && existsSync(target) && extname(target)) return target;
  // Clean URLs: /admin -> admin.html
  if (rel && existsSync(`${target}.html`)) return `${target}.html`;
  if (!rel) return join(ROOT, 'index.html');
  // Every other path is a card slug, exactly like the Vercel rewrite.
  return join(ROOT, 'card.html');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const file = resolveFile(url.pathname);
    if (!file) return send(res, 403, 'nope');
    const body = await readFile(file);
    return send(res, 200, body, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  } catch (err) {
    console.error(err);
    return send(res, 500, 'server error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Admin  →  http://localhost:${PORT}/admin`);
  console.log(`  Site   →  http://localhost:${PORT}/\n`);
  console.log('  Local only. Press Ctrl+C to stop.\n');
});
