// Landing page. Anyone who reaches the bare domain lands here — there's nothing
// to do but read, since every card comes from a QR code I hand out personally.
import { SITE } from './config.js';
import { renderCard } from './card-render.js';
import { STRINGS, mountLangToggle, pick } from './i18n.js';

const $ = (id) => document.getElementById(id);

const SAMPLE = {
  en: 'Berlin, a whiteboard, and a room full of people who actually cared. Thanks for being part of it.',
  ar: 'برلين، وسبورة، وأوضة مليانة ناس مهتمة بجد. شكراً إنك كنت جزء من ده.',
};

/**
 * The poem is always Arabic, so it renders the same in either UI language.
 * Each verse is a بيت of two hemistichs, set side by side like printed verse.
 */
async function paintPoem() {
  try {
    const res = await fetch('/data/poem.json', { cache: 'no-cache' });
    const poem = await res.json();
    if (!poem.verses?.length) return;

    const box = $('poem-lines');
    box.replaceChildren();
    for (const verse of poem.verses) {
      const row = document.createElement('p');
      row.className = 'bayt';
      for (const half of [].concat(verse)) {
        const span = document.createElement('span');
        span.textContent = half;
        row.append(span);
      }
      box.append(row);
    }
    $('poem-author').textContent = poem.author || '';
    $('poem').classList.remove('hidden');
  } catch {
    // A missing poem is not worth an error message on a keepsake page.
  }
}

async function paint(lang) {
  $('eyebrow').textContent = pick(SITE.eyebrow, lang);
  $('footnote').textContent = pick(SITE.org, lang);

  const canvas = await renderCard({
    side: 'front',
    text: SAMPLE[lang] || SAMPLE.en,
    lang,
    scale: 1,
  });
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', STRINGS[lang].tagline);
  const frame = $('preview');
  frame.querySelector('canvas, .skeleton')?.remove();
  frame.append(canvas);
}

const getLang = mountLangToggle($('lang'), paint);
paint(getLang());
paintPoem();
