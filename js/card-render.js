// ---------------------------------------------------------------------------
// The canvas engine. Draws one side of the card at any scale.
//
// Text goes on a canvas rather than in HTML for three reasons: the browser
// shapes Arabic correctly, the same pixels end up in the PNG and the PDF, and
// there is no html2canvas font-loading race to lose.
// ---------------------------------------------------------------------------
import { CARD_ART, CARD_LAYOUT, TYPE } from './config.js';

const imageCache = new Map();

function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Could not load ${src}`));
        img.src = src;
      }),
    );
  }
  return imageCache.get(src);
}

/**
 * Fonts must be ready before the first measureText, or we silently measure
 * against a fallback face and lay the text out wrong.
 */
let fontsReady;
export function ensureFonts() {
  if (!fontsReady) {
    fontsReady = (async () => {
      if (!document.fonts) return;
      // Nudge the browser into actually fetching both faces before we wait.
      await Promise.all([
        document.fonts.load('600 40px Poppins', 'Sample'),
        document.fonts.load('600 40px Cairo', 'مثال'),
      ]).catch(() => {});
      await document.fonts.ready;
    })();
  }
  return fontsReady;
}

/** Greedy word wrap. Falls back to per-character breaking for long unbroken runs. */
function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${line} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  }

  // A single "word" wider than the box (a long URL, a pasted string) would
  // otherwise overflow no matter how small the font gets.
  const broken = [];
  for (const line of lines) {
    if (ctx.measureText(line).width <= maxWidth || line.length < 2) {
      broken.push(line);
      continue;
    }
    let chunk = '';
    for (const ch of line) {
      if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
        broken.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    if (chunk) broken.push(chunk);
  }
  return broken;
}

/**
 * Shrink the font until the wrapped text fits the box in both axes.
 * Returns the chosen size and the lines at that size.
 */
function fitText(ctx, text, box, style, scale) {
  const maxSize = TYPE.maxSize * scale;
  const minSize = TYPE.minSize * scale;

  let best = { size: minSize, lines: [] };
  for (let size = maxSize; size >= minSize; size -= 1) {
    ctx.font = `${style.weight} ${size}px ${style.family}, system-ui, sans-serif`;
    const lines = wrap(ctx, text, box.width);
    const height = lines.length * size * style.lineHeight;
    if (height <= box.height) return { size, lines };
    best = { size, lines }; // keep the smallest attempt as a floor
  }
  return best; // may slightly overflow only if the message is extremely long
}

function resolveBox(side, scale) {
  const art = CARD_ART[side];
  const l = CARD_LAYOUT[side];
  const w = art.width * scale;
  const h = art.height * scale;
  return {
    x: l.x0 * w,
    y: l.y0 * h,
    width: (l.x1 - l.x0) * w,
    height: (l.y1 - l.y0) * h,
  };
}

/**
 * Render one card side.
 *
 * @param {'front'|'back'} side
 * @param {string} text     the message body
 * @param {string} [name]   optional signature line, drawn under the message
 * @param {'en'|'ar'} lang
 * @param {number} scale    1 for preview, EXPORT_SCALE for download
 * @param {boolean} debug   draw the safe-zone box
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderCard({ side, text, name = '', lang = 'en', scale = 1, debug = false }) {
  await ensureFonts();
  const art = CARD_ART[side];
  const img = await loadImage(art.src);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(art.width * scale);
  canvas.height = Math.round(art.height * scale);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const style = TYPE[lang] || TYPE.en;
  const rtl = lang === 'ar';
  const box = resolveBox(side, scale);

  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TYPE.color;

  // Reserve room for the signature line before fitting the body.
  const nameGap = name ? 0.55 : 0;
  const bodyBox = { ...box, height: box.height * (name ? 0.78 : 1) };

  const { size, lines } = fitText(ctx, text, bodyBox, style, scale);
  ctx.font = `${style.weight} ${size}px ${style.family}, system-ui, sans-serif`;

  const lineStep = size * style.lineHeight;
  const nameSize = size * TYPE.nameScale;
  const blockHeight = lines.length * lineStep + (name ? nameSize * style.lineHeight * (1 + nameGap) : 0);

  const centerX = box.x + box.width / 2;
  let y = box.y + (box.height - blockHeight) / 2 + lineStep / 2;

  for (const line of lines) {
    ctx.fillText(line, centerX, y);
    y += lineStep;
  }

  if (name) {
    y += nameSize * style.lineHeight * nameGap;
    ctx.font = `${style.weight === 600 ? 700 : style.weight} ${nameSize}px ${style.family}, system-ui, sans-serif`;
    ctx.fillStyle = TYPE.nameColor;
    ctx.fillText(rtl ? `— ${name}` : `— ${name}`, centerX, y);
  }

  if (debug) {
    ctx.save();
    ctx.strokeStyle = 'magenta';
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash([8 * scale, 6 * scale]);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.restore();
  }

  return canvas;
}

/** True when the current URL asks for the safe-zone overlay. */
export function isDebug() {
  return new URLSearchParams(location.search).get('debug') === '1';
}
