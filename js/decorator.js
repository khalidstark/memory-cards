// ---------------------------------------------------------------------------
// The card decorator: place stickers, move and resize them, and draw.
//
// Used by both the reply page and the admin, so it knows nothing about who is
// editing. The caller supplies the card artwork through `renderSide`, which is
// always the same renderCard() the finished card uses — that's what stops the
// preview and the export from ever drifting apart.
//
// Everything is stored in fractions of the card, never pixels, so a decoration
// made in a 340px preview lands in exactly the same place in a 2400px PDF.
// ---------------------------------------------------------------------------

/** Screen-space size of the drag handles, in CSS pixels. Thumb-sized. */
const HANDLE = 17;
const MIN_SCALE = 0.05;
const MAX_SCALE = 0.9;

export const PALETTE = ['#161616', '#c20d0e', '#d19428', '#1b6ec2', '#ffffff'];
export const WIDTHS = [0.004, 0.009, 0.018]; // fractions of card width

const imgCache = new Map();
function loadImage(src) {
  if (!imgCache.has(src)) {
    imgCache.set(
      src,
      new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error(`could not load ${src}`));
        i.src = src;
      }),
    );
  }
  return imgCache.get(src);
}

/**
 * Draws one side's items onto a context sized w x h.
 * Pure: same items in, same pixels out, whatever the scale.
 */
function paintItems(ctx, w, h, items) {
  for (const it of items) {
    if (it.type === 'sticker') {
      if (!it.img) continue;
      const dw = it.scale * w;
      const dh = (dw * it.img.height) / it.img.width;
      ctx.save();
      ctx.translate(it.x * w, it.y * h);
      ctx.rotate(it.rot || 0);
      ctx.drawImage(it.img, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      continue;
    }
    // stroke
    if (!it.points || it.points.length < 1) continue;
    ctx.save();
    // The eraser is a stroke that removes what's under it, which keeps erasing
    // undoable and order-dependent like everything else.
    ctx.globalCompositeOperation = it.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = it.colour;
    ctx.lineWidth = Math.max(1, it.width * w);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const [first, ...rest] = it.points;
    ctx.moveTo(first.x * w, first.y * h);
    if (!rest.length) {
      // A single tap should still leave a dot.
      ctx.lineTo(first.x * w + 0.01, first.y * h);
    }
    for (const p of rest) ctx.lineTo(p.x * w, p.y * h);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * @param {object}   opts
 * @param {Element}  opts.mount         where the editor is built
 * @param {Array}    opts.stickers      [{ id, file }]
 * @param {Function} opts.renderSide    (side, scale) => Promise<HTMLCanvasElement>
 * @param {Function} [opts.labels]      () => i18n strings object
 * @param {Function} [opts.onChange]    called whenever the decoration changes
 */
export function createDecorator({ mount, stickers = [], renderSide, labels = () => ({}), onChange }) {
  const sides = ['front', 'back'];
  const state = {
    front: { items: [], base: null },
    back: { items: [], base: null },
  };
  let side = 'front';
  let tool = 'move'; // 'move' | 'draw' | 'erase'
  let colour = PALETTE[0];
  let width = WIDTHS[1];
  let selected = null; // index into state[side].items
  let cardCanvas = null; // the artwork, re-rendered on demand

  // --- build the DOM ------------------------------------------------------

  mount.classList.add('decorator');
  mount.replaceChildren();

  const tabs = el('div', 'dec-tabs');
  const sideBtns = {};
  for (const s of sides) {
    const b = el('button', 'dec-tab');
    b.type = 'button';
    b.dataset.side = s;
    b.addEventListener('click', () => setSide(s));
    sideBtns[s] = b;
    tabs.append(b);
  }

  const stage = el('div', 'dec-stage');
  const cardEl = el('canvas', 'dec-card');
  const layerEl = el('canvas', 'dec-layer');
  stage.append(cardEl, layerEl);

  const tools = el('div', 'dec-tools');
  const toolBtns = {};
  for (const t of ['move', 'draw', 'erase']) {
    const b = el('button', 'dec-tool');
    b.type = 'button';
    b.dataset.tool = t;
    b.addEventListener('click', () => setTool(t));
    toolBtns[t] = b;
    tools.append(b);
  }

  const swatches = el('div', 'dec-swatches');
  for (const c of PALETTE) {
    const b = el('button', 'dec-swatch');
    b.type = 'button';
    b.style.background = c;
    b.dataset.colour = c;
    b.setAttribute('aria-label', c);
    b.addEventListener('click', () => {
      colour = c;
      if (tool === 'erase') setTool('draw');
      syncChrome();
    });
    swatches.append(b);
  }

  const widthBtns = el('div', 'dec-widths');
  for (const w of WIDTHS) {
    const b = el('button', 'dec-width');
    b.type = 'button';
    b.dataset.w = String(w);
    const dot = el('span');
    dot.style.width = dot.style.height = `${6 + WIDTHS.indexOf(w) * 5}px`;
    b.append(dot);
    b.addEventListener('click', () => {
      width = w;
      syncChrome();
    });
    widthBtns.append(b);
  }

  const undoBtn = el('button', 'btn btn-ghost dec-act');
  undoBtn.type = 'button';
  undoBtn.addEventListener('click', undo);

  const clearBtn = el('button', 'btn btn-ghost dec-act');
  clearBtn.type = 'button';
  clearBtn.addEventListener('click', clearSide);

  const acts = el('div', 'dec-acts');
  acts.append(undoBtn, clearBtn);

  const tray = el('div', 'dec-tray');
  const trayLabel = el('p', 'hint dec-traylabel');

  mount.append(tabs, stage, tools, swatches, widthBtns, acts, trayLabel, tray);

  for (const s of stickers) {
    const b = el('button', 'stickerbtn');
    b.type = 'button';
    const img = el('img');
    img.src = `/assets/stickers/${s.file}`;
    img.alt = s.id.replace(/-/g, ' ');
    img.loading = 'lazy';
    b.append(img);
    b.addEventListener('click', () => addSticker(s));
    tray.append(b);
  }

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  // --- geometry -----------------------------------------------------------

  /** Layer canvas is sized to its own CSS box times DPR, so strokes look sharp. */
  function sizeLayer() {
    const r = stage.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    layerEl.width = Math.round(r.width * dpr);
    layerEl.height = Math.round(r.height * dpr);
    layerEl.style.width = `${r.width}px`;
    layerEl.style.height = `${r.height}px`;
  }

  /** Pointer position as a fraction of the card. */
  function frac(e) {
    const r = layerEl.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  /** Where a sticker's handles sit, in fractions, for hit-testing. */
  function handlesOf(it) {
    const r = layerEl.getBoundingClientRect();
    if (!r.width || !it.img) return null;
    const aspect = it.img.height / it.img.width;
    const halfW = it.scale / 2;
    const halfH = (it.scale * aspect * r.width) / r.height / 2;
    const cos = Math.cos(it.rot || 0);
    const sin = Math.sin(it.rot || 0);
    const corner = (sx, sy) => {
      const dx = sx * halfW * r.width;
      const dy = sy * halfH * r.height;
      return {
        x: it.x + (dx * cos - dy * sin) / r.width,
        y: it.y + (dx * sin + dy * cos) / r.height,
      };
    };
    return { size: corner(1, 1), del: corner(1, -1), halfW, halfH };
  }

  function near(a, b) {
    const r = layerEl.getBoundingClientRect();
    const dx = (a.x - b.x) * r.width;
    const dy = (a.y - b.y) * r.height;
    return Math.hypot(dx, dy) <= HANDLE;
  }

  /** Topmost sticker under the pointer, or -1. */
  function hit(p) {
    const items = state[side].items;
    const r = layerEl.getBoundingClientRect();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type !== 'sticker' || !it.img) continue;
      const h = handlesOf(it);
      if (!h) continue;
      // Rotate the point into the sticker's own frame, then it's a box test.
      const dx = (p.x - it.x) * r.width;
      const dy = (p.y - it.y) * r.height;
      const cos = Math.cos(-(it.rot || 0));
      const sin = Math.sin(-(it.rot || 0));
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= (h.halfW * r.width) && Math.abs(ly) <= h.halfH * r.height) return i;
    }
    return -1;
  }

  // --- painting -----------------------------------------------------------

  function paint() {
    sizeLayer();
    const ctx = layerEl.getContext('2d');
    const { width: w, height: h } = layerEl;
    ctx.clearRect(0, 0, w, h);

    const s = state[side];
    if (s.base) ctx.drawImage(s.base, 0, 0, w, h);
    paintItems(ctx, w, h, s.items);

    // Selection chrome is drawn last and never flattened into an export.
    const it = selected != null ? s.items[selected] : null;
    if (it && it.type === 'sticker') {
      const hh = handlesOf(it);
      if (hh) {
        const dpr = w / layerEl.getBoundingClientRect().width;
        ctx.save();
        ctx.translate(it.x * w, it.y * h);
        ctx.rotate(it.rot || 0);
        ctx.strokeStyle = '#c20d0e';
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.strokeRect(-hh.halfW * w, -hh.halfH * h, hh.halfW * 2 * w, hh.halfH * 2 * h);
        ctx.restore();

        for (const [pt, fill] of [
          [hh.size, '#c20d0e'],
          [hh.del, '#161616'],
        ]) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(pt.x * w, pt.y * h, HANDLE * 0.6 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 * dpr;
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  function syncChrome() {
    const t = labels();
    for (const s of sides) {
      sideBtns[s].textContent = s === 'front' ? t.front || 'Front' : t.back || 'Back';
      sideBtns[s].setAttribute('aria-pressed', String(s === side));
    }
    const names = { move: t.toolMove || 'Move', draw: t.toolDraw || 'Draw', erase: t.toolErase || 'Erase' };
    for (const k of Object.keys(toolBtns)) {
      toolBtns[k].textContent = names[k];
      toolBtns[k].setAttribute('aria-pressed', String(k === tool));
    }
    for (const b of swatches.children) {
      b.setAttribute('aria-pressed', String(b.dataset.colour === colour && tool !== 'erase'));
    }
    for (const b of widthBtns.children) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.w) === width));
    }
    const drawing = tool !== 'move';
    swatches.classList.toggle('hidden', !drawing);
    widthBtns.classList.toggle('hidden', !drawing);
    undoBtn.textContent = t.undo || 'Undo';
    clearBtn.textContent = t.clearSide || 'Clear this side';
    undoBtn.disabled = !state[side].items.length;
    trayLabel.textContent = t.trayLabel || 'Tap a sticker to add it';
    layerEl.style.cursor = drawing ? 'crosshair' : 'default';
  }

  function changed() {
    paint();
    syncChrome();
    onChange?.();
  }

  // --- editing ------------------------------------------------------------

  async function addSticker(s) {
    const img = await loadImage(`/assets/stickers/${s.file}`);
    // Cascade each new sticker slightly. Dropping them all dead-centre makes it
    // look like nothing happened when you add a second one.
    const n = state[side].items.filter((i) => i.type === 'sticker').length;
    const off = ((n % 5) - 2) * 0.06;
    state[side].items.push({
      type: 'sticker',
      id: s.id,
      img,
      x: 0.5 + off,
      y: 0.5 + off * 0.6,
      scale: 0.22,
      rot: 0,
    });
    selected = state[side].items.length - 1;
    setTool('move');
    changed();
  }

  function undo() {
    state[side].items.pop();
    selected = null;
    changed();
  }

  function clearSide() {
    state[side].items = [];
    state[side].base = null;
    selected = null;
    changed();
  }

  function setTool(t) {
    tool = t;
    if (t !== 'move') selected = null;
    changed();
  }

  async function setSide(s) {
    side = s;
    selected = null;
    await refresh();
  }

  // --- pointer handling ---------------------------------------------------

  let drag = null;

  layerEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    layerEl.setPointerCapture(e.pointerId);
    const p = frac(e);
    const items = state[side].items;

    if (tool !== 'move') {
      items.push({
        type: 'stroke',
        colour,
        width,
        erase: tool === 'erase',
        points: [p],
      });
      drag = { mode: 'stroke' };
      changed();
      return;
    }

    // Handles of the current selection win over everything beneath them.
    const cur = selected != null ? items[selected] : null;
    if (cur && cur.type === 'sticker') {
      const h = handlesOf(cur);
      if (h && near(p, h.del)) {
        items.splice(selected, 1);
        selected = null;
        drag = null;
        changed();
        return;
      }
      if (h && near(p, h.size)) {
        drag = { mode: 'size', i: selected };
        return;
      }
    }

    const i = hit(p);
    selected = i === -1 ? null : i;
    drag = i === -1 ? null : { mode: 'move', i, dx: p.x - items[i].x, dy: p.y - items[i].y };
    changed();
  });

  layerEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.preventDefault();
    const p = frac(e);
    const items = state[side].items;

    if (drag.mode === 'stroke') {
      const stroke = items[items.length - 1];
      const last = stroke.points[stroke.points.length - 1];
      // Skip micro-movements: fewer points means a smaller payload and a
      // smoother line, with no visible difference.
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.004) stroke.points.push(p);
      paint();
      return;
    }

    const it = items[drag.i];
    if (!it) return;

    if (drag.mode === 'move') {
      it.x = Math.min(1.1, Math.max(-0.1, p.x - drag.dx));
      it.y = Math.min(1.1, Math.max(-0.1, p.y - drag.dy));
    } else if (drag.mode === 'size') {
      const r = layerEl.getBoundingClientRect();
      const dx = (p.x - it.x) * r.width;
      const dy = (p.y - it.y) * r.height;
      // One handle does both: distance sets the size, angle sets the rotation.
      it.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (Math.hypot(dx, dy) * 2) / r.width));
      it.rot = Math.atan2(dy, dx) - Math.PI / 4;
    }
    paint();
  });

  for (const ev of ['pointerup', 'pointercancel']) {
    layerEl.addEventListener(ev, () => {
      if (drag) {
        drag = null;
        changed();
      }
    });
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(paint, 150);
  });

  // --- public API ---------------------------------------------------------

  /** Re-render the card artwork for the current side and repaint the overlay. */
  async function refresh() {
    cardCanvas = await renderSide(side, 1);
    cardEl.width = cardCanvas.width;
    cardEl.height = cardCanvas.height;
    cardEl.getContext('2d').drawImage(cardCanvas, 0, 0);
    stage.style.aspectRatio = `${cardCanvas.width} / ${cardCanvas.height}`;
    paint();
    syncChrome();
  }

  const hasContent = (s) => Boolean(state[s].items.length || state[s].base);

  /**
   * Flatten one side's decoration to a transparent canvas at `scale` times the
   * card's own pixel size. Returns null when there's nothing on that side, so
   * callers can skip storing an empty layer.
   */
  async function flatten(s, scale = 1.5) {
    if (!hasContent(s)) return null;
    const art = await renderSide(s, 1);
    const c = document.createElement('canvas');
    c.width = Math.round(art.width * scale);
    c.height = Math.round(art.height * scale);
    const ctx = c.getContext('2d');
    if (state[s].base) ctx.drawImage(state[s].base, 0, 0, c.width, c.height);
    paintItems(ctx, c.width, c.height, state[s].items);
    return c;
  }

  /**
   * Adopt an already-flattened decoration as a locked base layer. Because only
   * the flattened image is stored, previously placed stickers can't be moved
   * again — new work goes on top, and "Clear this side" starts over.
   */
  async function setBase(s, url) {
    state[s].base = url ? await loadImage(url).catch(() => null) : null;
    if (s === side) paint();
  }

  return {
    element: mount,
    refresh,
    setSide,
    getSide: () => side,
    hasContent,
    flatten,
    setBase,
    syncChrome,
    clearAll() {
      for (const s of sides) {
        state[s] = { items: [], base: null };
      }
      selected = null;
      changed();
    },
  };
}
