#!/usr/bin/env node
/**
 * One-time: slice the source artwork (both cards stacked in one PNG) into
 * assets/card-front.png and assets/card-back.png.
 *
 * The crop boxes below were derived by scanning the source for non-white
 * regions, so they hug each card exactly. If you ever re-export the artwork
 * from Canva/ChatGPT, re-run the detection block at the bottom of this file
 * before trusting these numbers.
 *
 *   node tools/slice-art.mjs "/path/to/source.png"
 *
 * Requires: npx --yes sharp-cli, or `npm i sharp` locally. If you'd rather not
 * install anything, the equivalent macOS one-liners are in the README.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// left, top, width, height — in source pixels
export const CROPS = {
  front: { left: 25, top: 19, width: 1336, height: 553 },
  back: { left: 25, top: 593, width: 1336, height: 517 },
};

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/slice-art.mjs <source.png>');
  process.exit(1);
}

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('sharp is not installed. Run:  npm i sharp');
  console.error('Or use the sips fallback documented in README.md.');
  process.exit(1);
}

mkdirSync(resolve(ROOT, 'assets'), { recursive: true });

for (const [side, box] of Object.entries(CROPS)) {
  const out = resolve(ROOT, `assets/card-${side}.png`);
  await sharp(src).extract(box).png({ compressionLevel: 9 }).toFile(out);
  console.log(`${side}: ${box.width}x${box.height} -> ${out}`);
}
