// The card page — the target of every QR code.
//
// A slug either resolves to an entry in data/people.json or it shows the
// "not assigned" page. There is no way to reach a card that isn't in that file,
// so every card that exists is one I deliberately made.
//
// Two kinds of entry, and both carry their own message that I wrote:
//   ready  — render it straight away.
//   ask    — the person types their own name first; {{name}} in the message is
//            replaced with what they typed.
import { SITE, MAX_NAME_LENGTH, DECORATION_SCALE } from './config.js';
import { renderCard, isDebug } from './card-render.js';
import { downloadPdf, saveToPhone, isIOS, withBusy } from './export.js';
import { STRINGS, mountLangToggle, applyLang, pick } from './i18n.js';
import { createDecorator } from './decorator.js';

const $ = (id) => document.getElementById(id);

/**
 * The slug can arrive two ways:
 *   /besho          — clean URL, via the rewrite (what the QR codes use)
 *   ?p=besho        — fallback for hosts without rewrites, or file:// testing
 */
function readSlug() {
  const q = new URLSearchParams(location.search).get('p');
  if (q) return q.toLowerCase();
  const path = decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g, '');
  if (!path || /\.html?$/i.test(path)) return '';
  return path.split('/').pop().toLowerCase();
}

let person = null; // the people.json entry
let answer = null; // the name they typed, once an ask entry is filled in
let getLang = () => 'en';

const isAsk = () => Boolean(person?.ask);

/** True when a { en, ar } pair actually contains something to print. */
export function hasText(pair) {
  return [pair?.en, pair?.ar].some((s) => typeof s === 'string' && s.trim());
}

/** Collapse whitespace and cap length so a pasted essay can't wreck the layout. */
function cleanName(raw) {
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

function fill(template, name) {
  return String(template).replaceAll('{{name}}', name);
}

/** The message and signature for whatever this page is currently showing. */
function currentCard() {
  const lang = getLang();
  // The card is a message *from* me, so the signature is my name. Who it's for
  // is the page heading, and names the downloaded file.
  const signature = pick(SITE.author, lang);
  const who = isAsk() ? answer : pick(person.name, lang);

  return {
    name: signature,
    filename: who,
    front: fill(pick(person.front, lang), who),
    back: fill(pick(person.back, lang), who),
    // Whatever Khalid drew on this card in the admin, so the page, the PDF and
    // the saved image all show the same thing.
    decorationFront: decorationUrl('front'),
    decorationBack: decorationUrl('back'),
    lang,
  };
}

/** Decoration layers are ordinary site assets, named in the people.json entry. */
function decorationUrl(sideName) {
  const file = person?.decoration?.[sideName];
  return file ? `/assets/decorations/${file}` : null;
}

async function paintCard() {
  const lang = getLang();
  const t = STRINGS[lang];
  const card = currentCard();

  $('heading').textContent = card.filename;
  $('footnote').textContent = pick(SITE.org, lang);
  document.title = `${card.filename} — ${pick(SITE.title, lang)}`;

  const debug = isDebug();
  const jobs = [
    { frame: 'frame-front', side: 'front', text: card.front, tag: t.front, name: '', deco: card.decorationFront },
    { frame: 'frame-back', side: 'back', text: card.back, tag: t.back, name: card.name, deco: card.decorationBack },
  ];

  for (const job of jobs) {
    const canvas = await renderCard({
      side: job.side,
      text: job.text,
      name: job.name,
      lang,
      scale: 1,
      debug,
      decoration: job.deco,
    });
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${job.tag}: ${job.text}`);
    const frame = $(job.frame);
    frame.querySelector('canvas, .skeleton')?.remove();
    frame.append(canvas);
  }
}

/** On desktop "Save to Photos" would be a lie — it's a plain download there. */
function labelSaveButton() {
  $('save').dataset.i18n = isIOS() ? 'savePhoto' : 'saveImage';
  applyLang(getLang());
}

const visible = (id) => !$(id).classList.contains('hidden');

function repaintAll() {
  labelSaveButton();
  $('footnote').textContent = pick(SITE.org, getLang());
  // Switching language while writing a reply should redraw *that* card, not
  // the one underneath it.
  if (visible('step-reply')) return void paintReplyPreview();
  if (visible('step-thanks')) return void showThanks();
  if (isAsk() && !answer) return; // still on the name form; nothing to redraw
  paintCard();
}

function showCard() {
  $('step-ask').classList.add('hidden');
  $('found').classList.remove('hidden');
  $('again').classList.toggle('hidden', !isAsk());
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showAsk() {
  answer = null;
  $('found').classList.add('hidden');
  $('step-ask').classList.remove('hidden');
  $('name').focus();
}

// --- replying with a card of their own --------------------------------------

let slug = '';
let sentReply = null; // { fromName, message, sticker } once it's been accepted
let decorator = null; // the sticker + drawing editor, built lazily
let sentLayers = null; // { front, back } data URLs once the reply is accepted

/**
 * Who is sending the reply. We already know: on an ask card they typed their
 * name to open it, and a ready card is addressed to one named person. Only
 * fall back to asking when a card somehow has neither.
 */
function senderName() {
  const known = isAsk() ? answer : pick(person?.name, getLang());
  return cleanName(known || '') || cleanName($('reply-name').value);
}

/** True when we had to fall back to asking. */
const mustAskName = () => !cleanName(isAsk() ? answer || '' : pick(person?.name, getLang()) || '');

/** The reply card as it currently reads, for preview and for the PDF. */
function replyCard() {
  const lang = getLang();
  const draft = sentReply || {
    fromName: senderName(),
    message: $('reply-message').value.trim(),
  };
  return {
    template: 'reply',
    name: draft.fromName,
    filename: draft.fromName || 'my-card',
    front: draft.message,
    back: '', // artwork only — whatever they drew goes on as a decoration layer
    decorationFront: sentLayers?.front || null,
    decorationBack: sentLayers?.back || null,
    lang,
  };
}

/** One side of the reply card as artwork, for the decorator to sit on top of. */
async function renderReplySide(side, scale) {
  const card = replyCard();
  return renderCard({
    template: 'reply',
    side,
    text: side === 'front' ? card.front || ' ' : '',
    name: side === 'front' ? card.name : '',
    lang: card.lang,
    scale,
    debug: isDebug(),
  });
}

let replyToken = 0;
/** Redraw the card underneath the decoration, e.g. after typing or a language flip. */
async function paintReplyPreview() {
  const token = ++replyToken;
  if (!decorator) return;
  await decorator.refresh();
  if (token !== replyToken) return; // a newer keystroke already won
}

/** Preview on every keystroke would re-render mid-word; wait for a pause. */
function debounce(fn, ms = 260) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
const previewReplySoon = debounce(() => paintReplyPreview());

function showReplyForm() {
  $('found').classList.add('hidden');
  $('step-thanks').classList.add('hidden');
  $('step-reply').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Don't ask for a name we already have — just show whose card it will be.
  const ask = mustAskName();
  $('reply-name-field').classList.toggle('hidden', !ask);
  const badge = $('reply-as');
  badge.classList.toggle('hidden', ask);
  if (!ask) badge.textContent = `${STRINGS[getLang()].replyingAs} ${senderName()}`;

  (ask ? $('reply-name') : $('reply-message')).focus();
  paintReplyPreview();
}

function showCardAgain() {
  $('step-reply').classList.add('hidden');
  $('step-thanks').classList.add('hidden');
  $('found').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function showThanks() {
  $('step-reply').classList.add('hidden');
  $('step-thanks').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const card = replyCard();
  for (const [frameId, side, deco] of [
    ['thanks-frame-front', 'front', card.decorationFront],
    ['thanks-frame-back', 'back', card.decorationBack],
  ]) {
    const canvas = await renderCard({
      template: 'reply',
      side,
      text: side === 'front' ? card.front : '',
      name: side === 'front' ? card.name : '',
      lang: card.lang,
      scale: 1,
      decoration: deco,
    });
    const frame = $(frameId);
    frame.querySelector('canvas, .skeleton')?.remove();
    frame.append(canvas);
  }
}

async function sendReply(e) {
  e.preventDefault();
  const t = STRINGS[getLang()];
  const err = $('reply-err');
  const fromName = senderName();
  const message = $('reply-message').value.trim();

  if (!fromName) {
    err.textContent = t.nameRequired;
    $('reply-name').focus();
    return;
  }
  if (!message) {
    err.textContent = t.messageRequired;
    $('reply-message').focus();
    return;
  }
  err.textContent = '';

  const btn = $('reply-send');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = t.replySending;

  try {
    // Flatten now, at print resolution, so what Khalid receives is exactly
    // what they made rather than an upscaled thumbnail.
    const layers = {};
    for (const s of ['front', 'back']) {
      const c = decorator && decorator.hasContent(s) ? await decorator.flatten(s, DECORATION_SCALE) : null;
      layers[s] = c ? c.toDataURL('image/png') : null;
    }
    const res = await fetch('/api/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toSlug: slug,
        fromName,
        message,
        lang: getLang(),
        decorationFront: layers.front,
        decorationBack: layers.back,
        website: $('reply-hp').value, // honeypot — must stay empty
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      // A 4xx means the person can do something about it ("message too long"),
      // so show what the server said. Anything else is our problem, not theirs
      // — don't put an internal string in front of them.
      const actionable = res.status >= 400 && res.status < 500 && out.error;
      throw new Error(actionable ? out.error : t.replyFailed);
    }

    // Only now is it safe to stop treating the form as the source of truth.
    sentReply = { fromName, message };
    sentLayers = layers;
    await showThanks();
  } catch (netErr) {
    // Never clear the form on failure — retyping a heartfelt message because
    // the wifi dropped is the worst possible outcome here.
    err.textContent = navigator.onLine ? netErr.message || t.replyFailed : t.replyOffline;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/** Built lazily: 32 sticker thumbnails shouldn't load until they're wanted. */
async function buildDecorator() {
  if (decorator) return;
  let stickers = [];
  try {
    const data = await fetch('/data/stickers.json', { cache: 'no-cache' }).then((r) => r.json());
    stickers = data.stickers || [];
  } catch {
    stickers = []; // the editor still works for drawing without any stickers
  }
  decorator = createDecorator({
    mount: $('reply-decorator'),
    stickers,
    renderSide: renderReplySide,
    labels: () => STRINGS[getLang()],
  });
  await decorator.refresh();
}

function wireReply() {
  $('open-reply').addEventListener('click', () => {
    showReplyForm();
    buildDecorator();
  });
  $('reply-cancel').addEventListener('click', showCardAgain);
  $('back-to-card').addEventListener('click', showCardAgain);
  $('reply-form').addEventListener('submit', sendReply);

  $('reply-name').addEventListener('input', previewReplySoon);
  $('reply-message').addEventListener('input', () => {
    $('reply-count').textContent = String($('reply-message').value.length);
    previewReplySoon();
  });

  $('reply-pdf').addEventListener('click', (e) => {
    $('thanks-err').textContent = '';
    withBusy(e.currentTarget, STRINGS[getLang()].working, () => downloadPdf(replyCard())).catch(() => {
      $('thanks-err').textContent = STRINGS[getLang()].loadError;
    });
  });
}

function wire() {
  const fail = () => {
    $('err').textContent = STRINGS[getLang()].loadError;
  };

  $('pdf').addEventListener('click', (e) => {
    $('err').textContent = '';
    withBusy(e.currentTarget, STRINGS[getLang()].working, () => downloadPdf(currentCard())).catch(fail);
  });

  $('save').addEventListener('click', (e) => {
    $('err').textContent = '';
    withBusy(e.currentTarget, STRINGS[getLang()].working, () => saveToPhone(currentCard())).catch(fail);
  });

  $('again').addEventListener('click', showAsk);

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = cleanName($('name').value);
    if (!name) {
      $('err-ask').textContent = STRINGS[getLang()].nameRequired;
      $('name').focus();
      return;
    }
    $('err-ask').textContent = '';
    answer = name;
    showCard();
    paintCard();
  });
}

async function main() {
  getLang = mountLangToggle($('lang'), repaintAll);

  slug = readSlug();
  let people = {};
  try {
    const res = await fetch('/data/people.json', { cache: 'no-cache' });
    people = await res.json();
  } catch {
    $('err').textContent = STRINGS[getLang()].loadError;
  }

  person = slug && !slug.startsWith('_') ? people[slug] : null;

  // An entry with no message renders a blank card, which looks broken and is
  // worse than saying so plainly. Note the check is for actual *text*: a
  // half-written card saved as { en: '', ar: '' } has the keys but nothing in
  // them, and that shape is exactly what a draft in the admin looks like.
  if (person && !hasText(person.front) && !hasText(person.back)) person = null;

  if (!person) {
    $('missing').classList.remove('hidden');
    applyLang(getLang());
    return;
  }

  wire();
  labelSaveButton();
  $('footnote').textContent = pick(SITE.org, getLang());

  // Only cards Khalid marked as accepting replies show the invitation. The
  // endpoint enforces this too — the button being hidden is a courtesy, not
  // the control.
  if (person.reply) {
    $('reply-invite').classList.remove('hidden');
    wireReply();
  }

  if (isAsk()) {
    $('step-ask').classList.remove('hidden');
    $('name').focus();
    return;
  }

  $('found').classList.remove('hidden');
  await paintCard();
}

main();
