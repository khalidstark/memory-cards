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

function repaintAll() {
  labelSaveButton();
  $('footnote').textContent = pick(SITE.org, getLang());
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

  const slug = readSlug();
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

  if (isAsk()) {
    $('step-ask').classList.remove('hidden');
    $('name').focus();
    return;
  }

  $('found').classList.remove('hidden');
  await paintCard();
}

main();
