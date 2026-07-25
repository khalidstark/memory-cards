// ---------------------------------------------------------------------------
// The only file you normally need to touch for setup.
// ---------------------------------------------------------------------------

/** Your LinkedIn profile. Shown on every page. */
export const LINKEDIN_URL = 'https://www.linkedin.com/in/YOUR-PROFILE-HERE';

export const SITE = {
  /**
   * Deliberately English in both languages — it's the event name printed on the
   * card artwork, so translating it would make the page disagree with the card.
   */
  title: 'Connects AI — Berlin Workshop',
  eyebrow: 'Berlin · 2026',
  org: { en: 'German International University', ar: 'الجامعة الألمانية الدولية' },
  /** Signs the back of every card. */
  author: { en: 'Khalid', ar: 'خالد' },
};

/**
 * The card artwork, by template.
 *
 *   giu   — the cards Khalid sends. Each side keeps its own native size; they
 *           are not the same aspect ratio and squashing them would distort the
 *           logos.
 *   reply — the card people send back. A different design on purpose, so nobody
 *           is replying on Khalid's own stationery.
 */
export const CARD_ART = {
  giu: {
    front: { src: '/assets/card-front.png', width: 1336, height: 553 },
    back: { src: '/assets/card-back.png', width: 1336, height: 517 },
  },
  reply: {
    front: { src: '/assets/reply-front.png', width: 2672, height: 1106 },
    // Rendered as artwork only — never drawn on. It exists so the printed card
    // has a blank side for a sticker or a drawing.
    back: { src: '/assets/reply-back.png', width: 2672, height: 1106 },
  },
};

/**
 * Where text is allowed to go, as a fraction of each card's width/height.
 * Measured off the empty region in each artwork, then inset slightly so no
 * glyph touches a ragged edge.
 *
 * To retune: open any card with ?debug=1 — the boxes are drawn in magenta.
 */
export const CARD_LAYOUT = {
  giu: {
    front: { x0: 0.424, y0: 0.415, x1: 0.838, y1: 0.865 },
    back: { x0: 0.466, y0: 0.205, x1: 0.842, y1: 0.752 },
  },
  reply: {
    // Measured off the empty region in reply-front.png, then inset.
    // Re-measure with tools/measure-safe-area.mjs when the real artwork lands.
    front: { x0: 0.108, y0: 0.243, x1: 0.892, y1: 0.739 },
    back: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, // unused — back is artwork only
  },
};

/** Sides that carry no text, whatever is passed in. */
export const ARTWORK_ONLY = { reply: ['back'] };

/** The default template, so every existing call site keeps working. */
export const DEFAULT_TEMPLATE = 'giu';

/** Typography. Sizes are in card-pixels at scale 1. */
export const TYPE = {
  en: { family: 'Poppins', weight: 600, lineHeight: 1.32 },
  ar: { family: 'Cairo', weight: 600, lineHeight: 1.62 },
  maxSize: 46,
  minSize: 15,
  color: '#2b2b2b',
  /** Name line drawn under the message on the front. */
  nameColor: '#1a1a1a',
  nameScale: 0.86,
};

/** Export resolution multiplier. 3x ≈ 4008x1659 — safely under iOS canvas caps. */
export const EXPORT_SCALE = 3;

/** Max characters accepted from the self-serve name field. */
export const MAX_NAME_LENGTH = 32;
