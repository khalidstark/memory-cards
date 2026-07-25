// Local-only admin page. Talks to tools/admin-server.mjs, which is the only
// thing that can write data/people.json — the deployed site has no such endpoint.
//
// The preview calls the same renderCard() the real card page uses, so what you
// see here is exactly what the person will get.
import { SITE } from './config.js';
import { renderCard } from './card-render.js';
import { pick } from './i18n.js';

const $ = (id) => document.getElementById(id);

let people = {}; // the whole file, including any _readme key
let current = null; // slug being edited
let dirty = false;
let prevLang = 'en';

/** Must match SCHEMA in tools/admin-server.mjs — the server rejects a mismatch
 *  so a stale browser tab can't overwrite good data with an old format. */
const SCHEMA = 2;
const BASE_KEY = 'giu-admin-base';
const isAsk = (e) => Boolean(e?.ask);
const realSlugs = () => Object.keys(people).filter((k) => !k.startsWith('_'));

/** True when a { en, ar } pair actually contains something to print. */
const hasText = (pair) => [pair?.en, pair?.ar].some((s) => typeof s === 'string' && s.trim());
/** A card with no words yet — fine to save as a draft, never fine to publish. */
const isEmpty = (e) => !hasText(e?.front) && !hasText(e?.back);

// --- status + toast ---------------------------------------------------------

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `pill ${kind}`;
}

let toastTimer;
function toast(message, bad = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

function markDirty() {
  dirty = true;
  setStatus('unsaved changes', 'dirty');
}

// --- roster -----------------------------------------------------------------

function renderList() {
  const list = $('list');
  list.replaceChildren();

  for (const slug of realSlugs()) {
    const entry = people[slug];
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-current', String(slug === current));

    const label = document.createElement('span');
    label.textContent = isAsk(entry) ? slug : pick(entry.name, 'en') || slug;
    const tag = document.createElement('span');
    const empty = isEmpty(entry);
    tag.className = `tag${empty ? ' empty' : isAsk(entry) ? ' ask' : ''}`;
    tag.textContent = empty ? 'empty' : isAsk(entry) ? 'asks' : 'ready';

    btn.append(label, tag);
    btn.addEventListener('click', () => select(slug));
    li.append(btn);
    list.append(li);
  }

  const n = realSlugs().length;
  const blank = realSlugs().filter((s) => isEmpty(people[s])).length;
  $('count').textContent =
    `${n} ${n === 1 ? 'card' : 'cards'} · ${realSlugs().filter((s) => isAsk(people[s])).length} ask for a name` +
    (blank ? ` · ${blank} still empty` : '');
}

// --- editor -----------------------------------------------------------------

/** Both types share the message fields now; only the name fields differ. */
function setType(type) {
  const ask = type === 'ask';
  for (const b of document.querySelectorAll('.segbtn')) {
    b.setAttribute('aria-pressed', String(b.dataset.type === type));
  }
  $('name-fields').classList.toggle('hidden', ask);
  $('askhint').classList.toggle('hidden', !ask);
}

function select(slug) {
  current = slug;
  const entry = people[slug];
  $('empty').classList.add('hidden');
  $('editor').classList.remove('hidden');

  $('slug').value = slug;
  setType(isAsk(entry) ? 'ask' : 'ready');

  $('name-en').value = entry.name?.en || '';
  $('name-ar').value = entry.name?.ar || '';
  $('front-en').value = entry.front?.en || '';
  $('front-ar').value = entry.front?.ar || '';
  $('back-en').value = entry.back?.en || '';
  $('back-ar').value = entry.back?.ar || '';

  renderList();
  updateUrlPreview();
  preview();
}

/** Reads the form back into `people[current]`. */
function collect() {
  if (!current) return;
  const ask = !$('askhint').classList.contains('hidden');

  const entry = {
    front: { en: $('front-en').value.trim(), ar: $('front-ar').value.trim() },
    back: { en: $('back-en').value.trim(), ar: $('back-ar').value.trim() },
  };
  if (ask) entry.ask = true;
  else entry.name = { en: $('name-en').value.trim(), ar: $('name-ar').value.trim() };

  people[current] = entry;
}

function updateUrlPreview() {
  const base = $('base').value.trim().replace(/\/+$/, '') || 'https://your-site.vercel.app';
  $('urlpreview').textContent = `${base}/${$('slug').value.trim() || '…'}`;
}

// --- preview ----------------------------------------------------------------

/**
 * What the two sides will say, given the current form state. For an ask card
 * {{name}} is filled with a stand-in so you can see how the sentence reads.
 */
function previewText() {
  const entry = people[current] || {};
  const lang = prevLang;
  const who = isAsk(entry)
    ? lang === 'ar'
      ? 'اسم الشخص'
      : 'Their name'
    : pick(entry.name, lang);
  const fill = (t) => String(pick(t, lang)).replaceAll('{{name}}', who);
  return { front: fill(entry.front), back: fill(entry.back) };
}

let previewToken = 0;
async function preview() {
  if (!current) return;
  const token = ++previewToken;
  const { front, back } = previewText();
  const lang = prevLang;
  const signature = pick(SITE.author, lang);

  const frames = $('preview').children;
  const jobs = [
    { i: 0, side: 'front', text: front || ' ', name: '' },
    { i: 1, side: 'back', text: back || ' ', name: signature },
  ];

  for (const job of jobs) {
    const canvas = await renderCard({
      side: job.side,
      text: job.text,
      name: job.name,
      lang,
      scale: 1,
    });
    if (token !== previewToken) return; // a newer keystroke already won
    const frame = frames[job.i];
    frame.querySelector('canvas, .skeleton')?.remove();
    frame.append(canvas);
  }
}

/** Preview on every keystroke would re-render mid-word; wait for a pause. */
function debounce(fn, ms = 260) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
const previewSoon = debounce(preview);

// --- adding / removing ------------------------------------------------------

function uniqueSlug(stem) {
  let slug = stem;
  let n = 2;
  while (people[slug]) slug = `${stem}-${n++}`;
  return slug;
}

function addReady() {
  const slug = uniqueSlug('new-person');
  people[slug] = {
    name: { en: '', ar: '' },
    front: { en: '', ar: '' },
    back: { en: '', ar: '' },
  };
  markDirty();
  select(slug);
  $('name-en').focus();
}

function addAsk() {
  const slug = uniqueSlug('new-group');
  people[slug] = {
    ask: true,
    // Pre-seeded so the {{name}} placeholder is discoverable rather than folklore.
    front: { en: '{{name}} — ', ar: '{{name}} — ' },
    back: { en: '', ar: '' },
  };
  markDirty();
  select(slug);
  $('front-en').focus();
}

function removeCurrent() {
  if (!current) return;
  const name = isAsk(people[current]) ? current : pick(people[current].name, 'en') || current;
  if (!confirm(`Delete "${name}"? Any QR code already printed for this person will stop working.`)) {
    return;
  }
  delete people[current];
  current = null;
  markDirty();
  $('editor').classList.add('hidden');
  $('empty').classList.remove('hidden');
  renderList();
}

/** Renaming a slug has to preserve position, or the roster reshuffles. */
function renameSlug(next) {
  if (!current || next === current) return;
  if (people[next]) {
    toast(`"${next}" is already taken`, true);
    $('slug').value = current;
    return;
  }
  const rebuilt = {};
  for (const [k, v] of Object.entries(people)) rebuilt[k === current ? next : k] = v;
  people = rebuilt;
  current = next;
  markDirty();
  renderList();
}

// --- saving -----------------------------------------------------------------

async function saveAll() {
  collect();
  const btn = $('save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const res = await fetch(`/api/people?schema=${SCHEMA}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(people),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'save failed');
    dirty = false;
    setStatus('saved', 'ok');
    toast(`Saved — ${out.count} ${out.count === 1 ? 'card' : 'cards'}`);
  } catch (err) {
    setStatus('not saved', 'bad');
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save all';
  }
}

/**
 * A QR code is permanent once printed, so this refuses to hand you one that
 * points at a card the live site doesn't have yet. Saving writes to your disk;
 * only deploying puts it online, and scanning the gap between the two gives
 * "this card isn't assigned yet".
 */
async function downloadQr() {
  const base = $('base').value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) {
    toast('Enter your live site URL at the top first', true);
    $('base').focus();
    return;
  }

  collect();
  if (isEmpty(people[current])) {
    toast('Write the message first — this card is still empty', true);
    $('front-en').focus();
    return;
  }

  const btn = $('qr');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Checking…';
  try {
    if (dirty) await saveAll(); // never build a code from unsaved text

    const slug = $('slug').value.trim();
    const check = await fetch(
      `/api/check?slug=${encodeURIComponent(slug)}&base=${encodeURIComponent(base)}`,
    ).then((r) => r.json());

    if (check.reachable && !check.live) {
      toast(`"${slug}" isn’t published yet — run: npm run deploy`, true);
      return;
    }
    if (check.reachable && !check.current) {
      const go = confirm(
        `"${slug}" is live, but the version online is older than what you just saved.\n\n` +
          `The QR code will still work — it points at the right page — but the message ` +
          `shown will be the old one until you run: npm run deploy\n\nDownload anyway?`,
      );
      if (!go) return;
    }

    const a = document.createElement('a');
    a.href = `/api/qr?slug=${encodeURIComponent(slug)}&base=${encodeURIComponent(base)}`;
    a.download = `${slug}-qr.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`QR downloaded — ${base}/${slug}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// --- wiring -----------------------------------------------------------------

function wire() {
  for (const id of ['name-en', 'name-ar', 'front-en', 'front-ar', 'back-en', 'back-ar']) {
    $(id).addEventListener('input', () => {
      collect();
      markDirty();
      previewSoon();
    });
  }

  $('slug').addEventListener('input', updateUrlPreview);
  $('slug').addEventListener('change', (e) => {
    const cleaned = e.target.value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    e.target.value = cleaned;
    if (cleaned) renameSlug(cleaned);
    else e.target.value = current;
    updateUrlPreview();
  });

  for (const b of document.querySelectorAll('.segbtn')) {
    b.addEventListener('click', () => {
      setType(b.dataset.type);
      collect();
      markDirty();
      renderList(); // the roster badge flips between "ready" and "asks"
      preview();
    });
  }

  $('add-ready').addEventListener('click', addReady);
  $('add-ask').addEventListener('click', addAsk);
  $('delete').addEventListener('click', removeCurrent);
  $('save').addEventListener('click', saveAll);
  $('qr').addEventListener('click', downloadQr);

  $('open').addEventListener('click', () => {
    window.open(`/${$('slug').value.trim()}`, '_blank', 'noopener');
  });

  $('prevlang').addEventListener('click', () => {
    prevLang = prevLang === 'en' ? 'ar' : 'en';
    $('prevlang').textContent = prevLang === 'en' ? 'العربية' : 'English';
    preview();
  });

  $('base').addEventListener('input', () => {
    localStorage.setItem(BASE_KEY, $('base').value.trim());
    updateUrlPreview();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveAll();
    }
  });

  // Closing with unsaved edits is almost always a mistake here.
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

async function main() {
  $('base').value = localStorage.getItem(BASE_KEY) || '';
  updateUrlPreview();

  try {
    const health = await fetch('/api/health');
    if (!health.ok) throw new Error();
    setStatus('connected', 'ok');
  } catch {
    setStatus('no server', 'bad');
    toast('Start the admin server with: npm run admin', true);
    return;
  }

  people = await fetch('/data/people.json', { cache: 'no-cache' }).then((r) => r.json());

  wire();
  renderList();
  const first = realSlugs()[0];
  if (first) select(first);
}

main();
