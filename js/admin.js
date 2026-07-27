// Local-only admin page. Talks to tools/admin-server.mjs, which is the only
// thing that can write data/people.json — the deployed site has no such endpoint.
//
// The preview calls the same renderCard() the real card page uses, so what you
// see here is exactly what the person will get.
import { SITE, DECORATION_SCALE } from './config.js';
import { renderCard } from './card-render.js';
import { downloadPdf, withBusy } from './export.js';
import { pick } from './i18n.js';
import { createDecorator } from './decorator.js';

const $ = (id) => document.getElementById(id);

let people = {}; // the whole file, including any _readme key
let current = null; // slug being edited
let decorator = null; // sticker + drawing editor, shared with the reply page
let stickerList = [];
/** Bumped on every save so the browser refetches a decoration it just changed. */
let decoVersion = Date.now();
/** Fingerprint of people.json as it was when this page loaded it. */
let baseVersion = null;
let dirty = false;
let prevLang = 'en';

/** Must match SCHEMA in tools/admin-server.mjs — the server rejects a mismatch
 *  so a stale browser tab can't overwrite good data with an old format. */
const SCHEMA = 4;
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
    if (entry?.reply) {
      const r = document.createElement('span');
      r.className = 'tag reply';
      r.textContent = 'reply';
      btn.append(r);
    }
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
  $('replies-view').classList.add('hidden');
  $('empty').classList.add('hidden');
  $('editor').classList.remove('hidden');

  $('slug').value = slug;
  setType(isAsk(entry) ? 'ask' : 'ready');

  $('allow-reply').checked = Boolean(entry.reply);
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
  // Only written when on, so an off card stays clean in the JSON.
  if ($('allow-reply').checked) entry.reply = true;
  // Decoration filenames are owned by the save routine, not the form — carry
  // whatever is already there so editing text can't drop the artwork.
  const prev = people[current];
  if (prev?.decoration) entry.decoration = prev.decoration;

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

  const deco = people[current]?.decoration || {};
  for (const job of jobs) {
    const canvas = await renderCard({
      side: job.side,
      text: job.text,
      name: job.name,
      lang,
      scale: 1,
      decoration: deco[job.side] ? `/assets/decorations/${deco[job.side]}?t=${decoVersion}` : null,
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

async function buildAdminDecorator() {
  if (decorator) return;
  try {
    const data = await fetch('/data/stickers.json', { cache: 'no-cache' }).then((r) => r.json());
    stickerList = data.stickers || [];
  } catch {
    stickerList = [];
  }
  decorator = createDecorator({
    mount: $('admin-decorator'),
    stickers: stickerList,
    renderSide: async (side, scale) => {
      const { front, back } = previewText();
      return renderCard({
        side,
        text: side === 'front' ? front || ' ' : back || ' ',
        name: side === 'front' ? '' : pick(SITE.author, prevLang),
        lang: prevLang,
        scale,
      });
    },
    labels: () => ({
      front: 'Front',
      back: 'Back',
      toolMove: 'Move',
      toolDraw: 'Draw',
      toolErase: 'Erase',
      undo: 'Undo',
      clearSide: 'Clear this side',
      trayLabel: 'Tap a sticker to add it',
    }),
    onChange: markDirty,
  });
  await decorator.refresh();
  // Existing decoration comes back as a locked base layer: only the flattened
  // image is stored, so earlier stickers can't be picked up and moved again.
  const deco = people[current]?.decoration || {};
  for (const side of ['front', 'back']) {
    if (deco[side]) await decorator.setBase(side, `/assets/decorations/${deco[side]}?t=${decoVersion}`);
  }
}

/** Writes both sides' layers, and records the filenames on the entry. */
async function saveDecoration(slug) {
  if (!decorator) return;
  const entry = people[slug];
  if (!entry) return;
  const deco = {};
  for (const side of ['front', 'back']) {
    const canvas = decorator.hasContent(side) ? await decorator.flatten(side, DECORATION_SCALE) : null;
    const res = await fetch('/api/decoration', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, side, png: canvas ? canvas.toDataURL('image/png') : null }),
    }).then((r) => r.json());
    if (res.file) deco[side] = res.file;
  }
  decoVersion = Date.now();
  if (Object.keys(deco).length) entry.decoration = deco;
  else delete entry.decoration;
}

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
    if (current) await saveDecoration(current);
    const res = await fetch(`/api/people?schema=${SCHEMA}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ people, baseVersion }),
    });
    const out = await res.json();
    if (!res.ok) {
      if (out.stale) {
        // Nothing was written. Say so loudly — a quiet failure here is how the
        // roster got silently restored twice.
        setStatus('out of date', 'bad');
        alert(out.error);
        return;
      }
      throw new Error(out.error || 'save failed');
    }
    baseVersion = out.version;
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

// --- replies people sent back -----------------------------------------------

/**
 * Replies arrive as commits in the memory-cards repo, so they only appear here
 * after a `git pull`. Nothing in this UI can know about one that hasn't been
 * pulled — hence the note telling him to pull.
 */
async function loadReplies() {
  try {
    const { replies } = await fetch('/api/replies', { cache: 'no-cache' }).then((r) => r.json());
    return replies || [];
  } catch {
    return [];
  }
}

async function showReplies() {
  $('editor').classList.add('hidden');
  $('empty').classList.add('hidden');
  $('replies-view').classList.remove('hidden');

  const list = $('replies-list');
  list.replaceChildren();
  const replies = await loadReplies();

  $('replies-note').textContent = replies.length
    ? `${replies.length} ${replies.length === 1 ? 'card' : 'cards'} · run "git pull" to fetch any newer ones`
    : 'Nothing yet. Replies arrive as commits — run "git pull" to fetch them.';

  for (const r of replies) {
    const item = document.createElement('article');
    item.className = 'replyitem';

    const head = document.createElement('header');
    const who = document.createElement('strong');
    who.textContent = r.fromName || '(no name)';
    const meta = document.createElement('small');
    const when = r.receivedAt ? new Date(r.receivedAt).toLocaleString() : '';
    meta.textContent = `to /${r.toSlug} · ${when}`;
    head.append(who, meta);

    const frame = document.createElement('div');
    frame.className = 'cardframe';
    const backFrame = document.createElement('div');
    backFrame.className = 'cardframe';

    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'btn btn-ghost';
    dl.textContent = 'Download as PDF';
    dl.addEventListener('click', (e) =>
      withBusy(e.currentTarget, 'Preparing…', () =>
        downloadPdf({
          template: 'reply',
          name: r.fromName,
          filename: r.fromName,
          front: r.message,
          back: '',
          decorationFront: r.decoration?.front ? `/replies/${r.decoration.front}` : null,
          decorationBack: r.decoration?.back ? `/replies/${r.decoration.back}` : null,
          lang: r.lang === 'ar' ? 'ar' : 'en',
        }),
      ).catch((err) => toast(err.message || 'Could not build the PDF', true)),
    );

    item.append(head, frame, backFrame, dl);
    list.append(item);

    const lang = r.lang === 'ar' ? 'ar' : 'en';
    // Decoration layers live next to the reply JSON in replies/.
    const layer = (side) => (r.decoration?.[side] ? `/replies/${r.decoration[side]}` : null);

    renderCard({
      template: 'reply',
      side: 'front',
      text: r.message,
      name: r.fromName,
      lang,
      scale: 1,
      decoration: layer('front'),
    }).then((canvas) => frame.append(canvas));
    renderCard({
      template: 'reply',
      side: 'back',
      text: '',
      lang,
      scale: 1,
      decoration: layer('back'),
    }).then((canvas) => backFrame.append(canvas));
  }
}

function hideReplies() {
  $('replies-view').classList.add('hidden');
  if (current) $('editor').classList.remove('hidden');
  else $('empty').classList.remove('hidden');
}

async function refreshReplyBadge() {
  const replies = await loadReplies();
  $('reply-badge').textContent = replies.length ? `(${replies.length})` : '';
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

  $('allow-reply').addEventListener('change', () => {
    collect();
    markDirty();
    renderList();
  });

  $('toggle-dec').addEventListener('click', async () => {
    const panel = $('admin-decorator');
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    $('toggle-dec').textContent = opening ? 'Hide decorator' : 'Decorate this card';
    if (opening) await buildAdminDecorator();
  });

  $('show-replies').addEventListener('click', showReplies);
  $('close-replies').addEventListener('click', hideReplies);

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

  // Through /api/people, not /data/people.json, so we get the version stamp
  // that stops this tab overwriting an edit made after it loaded.
  const loaded = await fetch('/api/people', { cache: 'no-cache' }).then((r) => r.json());
  people = loaded.people;
  baseVersion = loaded.version;

  wire();
  renderList();
  refreshReplyBadge();
  const first = realSlugs()[0];
  if (first) select(first);
}

main();
