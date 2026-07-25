// ---------------------------------------------------------------------------
// Turning the rendered canvases into things people can keep.
//
// Both exports embed the canvas as an image. That is deliberate: it means the
// Arabic in the PDF is the same shaped, correct text you see on screen, rather
// than jsPDF's own (poor) Arabic handling.
// ---------------------------------------------------------------------------
import { CARD_ART, DEFAULT_TEMPLATE, EXPORT_SCALE } from './config.js';
import { renderCard } from './card-render.js';

/** iPadOS reports as Mac, hence the touch check. */
export function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Desktop Chrome also answers `canShare({files}) === true`, but there the share
 * sheet is a worse experience than a plain download — and if the user ignores
 * the dialog, the promise never settles and the button stays stuck. So the
 * share path is reserved for phones and tablets, where it's the only way to get
 * an image into the camera roll.
 */
function preferShareSheet() {
  return isIOS() || /Android/.test(navigator.userAgent);
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), type, quality);
  });
}

function slugify(name) {
  return (
    String(name)
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}-]/gu, '')
      .slice(0, 40) || 'card'
  );
}

/**
 * `card.name` is the signature (mine) and only appears on the back, matching
 * what the page shows. `card.filename` is who the card is *for*, and only
 * names the downloaded file.
 */
async function renderBothSides(card, scale = EXPORT_SCALE) {
  const { lang } = card;
  const template = card.template || DEFAULT_TEMPLATE;
  return Promise.all([
    renderCard({ side: 'front', text: card.front, name: '', lang, scale, template }),
    renderCard({ side: 'back', text: card.back, name: card.name, lang, scale, template }),
  ]);
}

/**
 * Two-page PDF, one card per page, each page sized to its own card so nothing
 * is letterboxed or stretched. Width is fixed at 150mm; height follows the
 * artwork's real aspect ratio.
 */
export async function downloadPdf(card) {
  const { jsPDF } = window.jspdf;
  const [front, back] = await renderBothSides(card);

  const PAGE_WIDTH_MM = 150;
  const art = CARD_ART[card.template || DEFAULT_TEMPLATE];
  const sizeFor = (side) => [PAGE_WIDTH_MM, (PAGE_WIDTH_MM * art[side].height) / art[side].width];

  const frontSize = sizeFor('front');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: frontSize, compress: true });
  doc.addImage(front.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, frontSize[0], frontSize[1]);

  const backSize = sizeFor('back');
  doc.addPage(backSize, 'landscape');
  doc.addImage(back.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, backSize[0], backSize[1]);

  doc.save(`${slugify(card.filename || card.name || 'giu-card')}-card.pdf`);
}

/**
 * The stand-in for "Add to Apple Wallet" — real .pkpass files must be signed
 * with a paid Apple certificate we don't have. On iOS this opens the native
 * share sheet, where "Save Image" puts the card straight into Photos; that is
 * the closest equivalent that works for everyone today.
 *
 * Both sides are stacked into one tall image so nothing gets lost.
 */
export async function saveToPhone(card) {
  // One notch below print scale: stacking both sides means holding three large
  // canvases at once, and an older iPhone will drop them mid-encode at 3x.
  // 2x still lands at ~2670px wide, well beyond what any screen shows.
  const scale = Math.max(1, EXPORT_SCALE - 1);
  const [front, back] = await renderBothSides(card, scale);

  const gap = 24 * scale;
  const sheet = document.createElement('canvas');
  sheet.width = Math.max(front.width, back.width);
  sheet.height = front.height + gap + back.height;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.drawImage(front, (sheet.width - front.width) / 2, 0);
  ctx.drawImage(back, (sheet.width - back.width) / 2, front.height + gap);

  const blob = await canvasToBlob(sheet, 'image/png');
  const filename = `${slugify(card.filename || card.name || 'giu-card')}-card.png`;
  const file = new File([blob], filename, { type: 'image/png' });

  if (preferShareSheet() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      // The user dismissing the sheet is not an error worth surfacing.
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/**
 * Runs an export with a busy state on the button — a 3x render takes a
 * noticeable beat on an older phone, and an unresponsive button invites
 * double-taps.
 */
export async function withBusy(button, busyLabel, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
