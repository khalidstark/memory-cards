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
import { SITE, MAX_NAME_LENGTH } from './config.js';
import { renderCard, isDebug } from './card-render.js';
import { downloadPdf, saveToPhone, isIOS, withBusy } from './export.js';
import { STRINGS, mountLangToggle, applyLang, pick } from './i18n.js';

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
    lang,
  };
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
    { frame: 'frame-front', side: 'front', text: card.front, tag: t.front, name: '' },
    { frame: 'frame-back', side: 'back', text: card.back, tag: t.back, name: card.name },
  ];

  for (const job of jobs) {
    const canvas = await renderCard({
      side: job.side,
      text: job.text,
      name: job.name,
      lang,
      scale: 1,
      debug,
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
let sentReply = null; // { fromName, message } once it's been accepted

/** The reply card as it currently reads, for preview and for the PDF. */
function replyCard() {
  const lang = getLang();
  const draft = sentReply || {
    fromName: cleanName($('reply-name').value),
    message: $('reply-message').value.trim(),
  };
  return {
    template: 'reply',
    name: draft.fromName,
    filename: draft.fromName || 'my-card',
    front: draft.message,
    back: '', // artwork only — left blank for a sticker or a drawing
    lang,
  };
}

let replyToken = 0;
async function paintReplyPreview(frameId = 'reply-frame-front') {
  const token = ++replyToken;
  const card = replyCard();
  const canvas = await renderCard({
    template: 'reply',
    side: 'front',
    text: card.front || ' ',
    name: card.name,
    lang: card.lang,
    scale: 1,
    debug: isDebug(),
  });
  if (token !== replyToken) return; // a newer keystroke already won
  const frame = $(frameId);
  frame.querySelector('canvas, .skeleton')?.remove();
  frame.append(canvas);
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
  $('reply-name').focus();
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
  await paintReplyPreview('thanks-frame-front');
  // The back carries no text — it's the blank side they draw on.
  const back = await renderCard({ template: 'reply', side: 'back', text: '', lang: getLang(), scale: 1 });
  const frame = $('thanks-frame-back');
  frame.querySelector('canvas, .skeleton')?.remove();
  frame.append(back);
}

async function sendReply(e) {
  e.preventDefault();
  const t = STRINGS[getLang()];
  const err = $('reply-err');
  const fromName = cleanName($('reply-name').value);
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
    const res = await fetch('/api/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toSlug: slug,
        fromName,
        message,
        lang: getLang(),
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

function wireReply() {
  $('open-reply').addEventListener('click', showReplyForm);
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

/**
 * The melt sprite plays once and holds its final puddle frame. It can't do that
 * with animation-fill-mode: the last keyframe is one frame past the sheet edge
 * (that's what makes the loop wrap seamlessly), so holding it would show
 * nothing. Freeze it explicitly instead.
 */
function freezeMascotWhenDone() {
  const mascot = $('mascot');
  if (!mascot) return;
  mascot.addEventListener('animationend', (e) => {
    if (e.animationName === 'sprite-y') mascot.classList.add('done');
  });
}

async function main() {
  freezeMascotWhenDone();
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
