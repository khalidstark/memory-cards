// The Arabic verse shown on the landing page and under every card.
//
// Each entry in data/poem.json is one بيت of two hemistichs, set side by side
// on a wide screen and stacked on a phone, the way Arabic verse is printed.

/** Renders into #poem / #poem-lines / #poem-author if that markup is present. */
export async function paintPoem() {
  const box = document.getElementById('poem-lines');
  const wrap = document.getElementById('poem');
  if (!box || !wrap) return;
  try {
    const poem = await fetch('/data/poem.json', { cache: 'no-cache' }).then((r) => r.json());
    if (!poem.verses?.length) return;

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
    const author = document.getElementById('poem-author');
    if (author) author.textContent = poem.author || '';
    wrap.classList.remove('hidden');
  } catch {
    // A missing poem is not worth an error message on a keepsake page.
  }
}
