// Landing page. Anyone who reaches the bare domain lands here — there's nothing
// to do but read, since every card comes from a QR code I hand out personally.
import { SITE } from './config.js';
import { renderCard } from './card-render.js';
import { STRINGS, mountLangToggle, pick } from './i18n.js';
import { paintPoem } from './poem.js';

const $ = (id) => document.getElementById(id);

const SAMPLE = {
  en: 'Berlin, a whiteboard, and a room full of people who actually cared. Thanks for being part of it.',
  ar: 'برلين، وسبورة، وأوضة مليانة ناس مهتمة بجد. شكراً إنك كنت جزء من ده.',
};

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
