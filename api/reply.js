// ---------------------------------------------------------------------------
// POST /api/reply — someone sends a memory card back.
//
// This is the only server-side code in the project. Everything else is static
// files, so this endpoint is the entire attack surface: treat every field as
// hostile until proven otherwise.
//
// Replies are committed as JSON into the private memory-cards repo. They are
// never written into the deployed site — `replies/` is in .vercelignore, so
// nothing here can end up publicly readable.
// ---------------------------------------------------------------------------

// Raised from 4 KB to carry two flattened decoration layers. This is the
// biggest widening of the endpoint's surface, so each layer is validated
// individually below rather than trusting the overall cap.
const MAX_BODY_BYTES = 1_100_000;
const MAX_LAYER_BYTES = 400_000;
const MAX_NAME = 40;
const MAX_MESSAGE = 500;
const PNG_PREFIX = 'data:image/png;base64,';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const json = (res, code, body) => res.status(code).json(body);

/**
 * Collapse whitespace and strip control characters. Newlines become spaces:
 * a card is one flowing message, and a pasted block of line breaks would push
 * the auto-shrink past its floor and render unreadably small.
 */
function clean(value, limit) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

/**
 * Only accept posts that came from our own pages. This won't stop a determined
 * person with curl — nothing here can — but it blocks the casual case of
 * someone else's site posting into Khalid's repo.
 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * A decoration layer must be a real PNG, not merely a string claiming to be
 * one. Checking the magic bytes after decoding is what stops someone posting
 * arbitrary content that we'd then commit into the repo.
 *
 * @returns {Buffer|null|false}  buffer when valid, null when absent, false when bad
 */
function decodeLayer(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !value.startsWith(PNG_PREFIX)) return false;
  const b64 = value.slice(PNG_PREFIX.length);
  if (b64.length > MAX_LAYER_BYTES * 1.4) return false; // base64 is ~4/3 of raw
  let buf;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return false;
  }
  if (!buf.length || buf.length > MAX_LAYER_BYTES) return false;
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return false;
  return buf;
}

async function fetchJson(req, path) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const res = await fetch(`${proto}://${req.headers.host}${path}`, {
    headers: { 'cache-control': 'no-cache' },
  });
  if (!res.ok) throw new Error(`${path} unavailable (${res.status})`);
  return res.json();
}

/** The roster is public anyway; reading it over HTTP avoids bundling surprises. */
async function loadPeople(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const res = await fetch(`${proto}://${req.headers.host}/data/people.json`, {
    headers: { 'cache-control': 'no-cache' },
  });
  if (!res.ok) throw new Error(`roster unavailable (${res.status})`);
  return res.json();
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}` +
    `-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

async function commitToGitHub(path, contents, message) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repo) throw new Error('GITHUB_TOKEN or GITHUB_REPO is not set');

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      // Buffers go through as-is (a PNG); anything else is written as JSON.
      content: Buffer.isBuffer(contents)
        ? contents.toString('base64')
        : Buffer.from(JSON.stringify(contents, null, 2) + '\n', 'utf8').toString('base64'),
      branch,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GitHub refused the commit (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  if (!originAllowed(req)) return json(res, 403, { error: 'Bad origin' });

  const body = req.body ?? {};
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
    return json(res, 413, { error: 'Too much data' });
  }

  // Bots fill in every field they find; a real person never sees this one.
  if (clean(body.website, 50)) return json(res, 400, { error: 'No' });

  const toSlug = clean(body.toSlug, 60).toLowerCase();
  const fromName = clean(body.fromName, MAX_NAME);
  const message = clean(body.message, MAX_MESSAGE);
  const lang = body.lang === 'ar' ? 'ar' : 'en';

  const layers = {};
  for (const side of ['front', 'back']) {
    const key = side === 'front' ? 'decorationFront' : 'decorationBack';
    const decoded = decodeLayer(body[key]);
    if (decoded === false) return json(res, 400, { error: `That decoration didn't look like an image` });
    if (decoded) layers[side] = decoded;
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(toSlug)) return json(res, 400, { error: 'Bad card' });
  if (!fromName) return json(res, 400, { error: 'Name is required' });
  if (!message) return json(res, 400, { error: 'Message is required' });
  // Length is capped by clean(), so anything at the cap was over it.
  if (String(body.message ?? '').trim().length > MAX_MESSAGE) {
    return json(res, 400, { error: `Message must be ${MAX_MESSAGE} characters or fewer` });
  }
  if (String(body.fromName ?? '').trim().length > MAX_NAME) {
    return json(res, 400, { error: `Name must be ${MAX_NAME} characters or fewer` });
  }

  let people;
  try {
    people = await loadPeople(req);
  } catch (err) {
    console.error('roster load failed:', err.message);
    return json(res, 503, { error: 'Try again in a moment' });
  }

  // A reply can only go to a card that invited one. This is what stops the
  // endpoint from being an open write channel into the repo.
  const entry = people[toSlug];
  if (!entry || toSlug.startsWith('_')) return json(res, 404, { error: 'No such card' });
  if (!entry.reply) return json(res, 403, { error: 'This card is not accepting replies' });

  const now = new Date();
  const suffix = Math.random().toString(36).slice(2, 6);
  const stem = `${stamp(now)}-${toSlug}-${suffix}`;
  const decoration = {};

  try {
    // Layers commit first. If the run dies half way, an orphaned PNG is a much
    // smaller problem than a reply pointing at a file that never arrived.
    for (const [side, buf] of Object.entries(layers)) {
      const file = `${stem}-${side}.png`;
      await commitToGitHub(`replies/${file}`, buf, `Decoration (${side}) from ${fromName}`);
      decoration[side] = file;
    }
    await commitToGitHub(
      `replies/${stem}.json`,
      { toSlug, fromName, message, lang, decoration, receivedAt: now.toISOString() },
      `Reply from ${fromName} on /${toSlug}`,
    );
  } catch (err) {
    console.error('commit failed:', err.message);
    return json(res, 502, { error: 'Could not save your card. Please try again.' });
  }

  return json(res, 200, { ok: true });
}
