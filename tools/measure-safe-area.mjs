#!/usr/bin/env node
/**
 * Finds the empty region in a card artwork — the area where a message can be
 * drawn — and prints the fractions to paste into CARD_LAYOUT in js/config.js.
 *
 *   node tools/measure-safe-area.mjs assets/reply-front.png
 *
 * How it works: the artwork is mostly white/paper with one deliberately flat,
 * off-white block reserved for text (the beige brush on the GIU card, the beige
 * panel on the reply card). This finds the largest run of pixels matching that
 * fill and reports its bounding box, inset slightly so glyphs never touch a
 * ragged edge.
 *
 * If your artwork uses a different fill colour, pass it as the second argument:
 *
 *   node tools/measure-safe-area.mjs assets/reply-front.png "#eae0d5"
 *
 * Requires: npm i sharp
 */
import { resolve } from 'node:path';

const [, , file, hex] = process.argv;
if (!file) {
  console.error('usage: node tools/measure-safe-area.mjs <artwork.png> [#rrggbb]');
  process.exit(1);
}

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('sharp is not installed. Run:  npm i sharp');
  process.exit(1);
}

const { data, info } = await sharp(resolve(file))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels } = info;

/** Default: any warm off-white that is clearly not the paper background. */
function isFill(r, g, b) {
  if (hex) {
    const t = hex.replace('#', '');
    const [tr, tg, tb] = [0, 2, 4].map((i) => parseInt(t.slice(i, i + 2), 16));
    return Math.abs(r - tr) < 14 && Math.abs(g - tg) < 14 && Math.abs(b - tb) < 14;
  }
  return r > 225 && r < 250 && g > 205 && g < 242 && b > 195 && b < 235 && r - b > 8;
}

let minX = W;
let minY = H;
let maxX = -1;
let maxY = -1;
let hits = 0;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * channels;
    if (!isFill(data[i], data[i + 1], data[i + 2])) continue;
    hits++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}

if (hits < W * H * 0.01) {
  console.error(
    `Only ${hits} matching pixels found — less than 1% of the image.\n` +
      'The message area probably uses a different colour. Pass it explicitly:\n' +
      `  node tools/measure-safe-area.mjs ${file} "#rrggbb"`,
  );
  process.exit(1);
}

// Inset so no glyph lands on a ragged or anti-aliased edge. Vertical inset is
// larger because line-height already pads the sides but not the top and bottom.
const IN_X = 0.022;
const IN_Y = 0.053;
const f = (n) => n.toFixed(3);

console.log(`${file} — ${W}x${H}, ratio ${(W / H).toFixed(3)}`);
console.log(`raw box: x ${minX}..${maxX}, y ${minY}..${maxY} (${hits.toLocaleString()} px)\n`);
console.log('Paste into CARD_LAYOUT in js/config.js:\n');
console.log(
  `  { x0: ${f(minX / W + IN_X)}, y0: ${f(minY / H + IN_Y)}, ` +
    `x1: ${f(maxX / W - IN_X)}, y1: ${f(maxY / H - IN_Y)} },`,
);
console.log('\nThen check it with ?debug=1 on a card and nudge if needed.');
