# Connects AI — Berlin Workshop farewell cards

A tiny static site. Every card is opened by a QR code you assign — there is no
public page where someone can make a card for themselves. Scanning a code opens
that person's card, which they can download as a PDF or save to their phone.

No server, no database, no running cost.

---

## Before you deploy — do these two things

**1. Put your LinkedIn URL in `js/config.js`:**

```js
export const LINKEDIN_URL = 'https://www.linkedin.com/in/YOUR-PROFILE-HERE';
```

**2. Write the messages in `data/people.json`.** Every QR code you hand out is
one entry in this file. Nothing else can produce a card.

There are two kinds of entry.

**Ready card** — you wrote the message yourself:

```json
"besho": {
  "name": { "en": "Besho", "ar": "بيشو" },
  "front": { "en": "front of the card…", "ar": "…" },
  "back":  { "en": "back of the card…",  "ar": "…" }
}
```

**Ask card** — you write the message too, but the person who scans types their
own name. Anywhere you put `{{name}}`, their name appears:

```json
"team": {
  "ask": true,
  "front": { "en": "{{name}} — we built and argued and figured it out.", "ar": "…" },
  "back":  { "en": "Thanks for showing up properly, {{name}}.", "ar": "…" }
}
```

They see one box: their name. If you want different wording for different
groups, make a separate ask card (and its own QR) for each — that's the whole
point of assigning the codes yourself.

`{{name}}` works on ready cards too, though there you'd normally just type the
name straight in.

The key (`besho`, `team`) becomes the URL — `yoursite.com/besho`. Lowercase
letters, numbers and dashes only. Delete the `sample-person` entry and the
`_readme` key when you're done.

> Reserved keys you can't use as a slug: `index`, `assets`, `js`, `data`,
> `vendor`, `qr`.

**3. The poem** on the landing page lives in `data/poem.json`. Each entry in
`verses` is one بيت — `[صدر, عجز]` — set side by side on a wide screen and
stacked on a phone. Set `"verses": []` to hide the section.

---

## The admin page

Instead of editing JSON by hand:

```bash
npm run admin        # http://localhost:4174/admin
```

A roster on the left, an editor on the right, and a **live preview of the actual
card** as you type — it calls the same rendering code the real page uses, so
what you see is what the person gets.

- **+ Ready card** — you write both messages yourself
- **+ Ask card** — the person types their own name when they scan. Tick one
  workshop and they see no dropdown, just a name box
- **Download QR code** — one high-res PNG for whoever is selected. Put your live
  site URL in the box at the top first, or the code points nowhere
- **Save all** (or ⌘S) writes `data/people.json`

It runs on your machine only, bound to `127.0.0.1`. There is no login because
there is nothing to log into — and `.vercelignore` keeps `admin.html`, its CSS,
its JS and the whole `tools/` folder out of the deploy, so the live site has no
admin page and no way to write anything.

Editing `data/people.json` by hand still works exactly as before; the admin page
just writes the same file.

---

## Run it locally

```bash
npm run dev          # http://localhost:4173
```

Then try:

| URL | What it should show |
|---|---|
| `/` | landing page with a sample card |
| `/besho` | Besho's card, both sides |
| `/team` | an "ask" card — type a name, then the card appears |
| `/anything-else` | friendly "not assigned yet" page |
| `/besho?lang=ar` | the same card in Arabic |
| `/besho?debug=1` | magenta boxes showing where text is allowed to go |

---

## Deploy

The live site is a *copy* of this folder on Vercel. Editing a card here changes
nothing online until you push that copy up:

```bash
npm run deploy
```

Takes about 20 seconds. The URL never changes — it's always
https://giu-farewell.vercel.app — and each person is just a path on it
(`/besho`, `/mariam`). Adding someone doesn't create a new site or a new URL.

**The everyday loop:**

1. `npm run admin` — write the cards, Save all
2. `npm run deploy` — push them live
3. `npm run qr https://giu-farewell.vercel.app` — codes + printable sheet

Batch it: write everyone first, publish once, then make the codes. A QR code for
a card you haven't published yet shows "not assigned yet" when scanned.

---

## Generate the QR codes — do this LAST

Only after the site is live and the URL is final. Printed codes can't be edited.

```bash
npm run qr https://your-actual-site.vercel.app
```

This writes:

- `qr/<slug>.png` — one code per entry in `people.json`
- `qr/index.html` — a printable A4 sheet with names under each code. Ask cards
  are outlined in red and labelled "asks for name" so you don't mix them up

Open `qr/index.html` in a browser and print it, then cut along the dashed lines.

**Scan one printed code with a real phone before printing the rest.**

---

## Editing the card text position

If text sits slightly off the beige brush stroke, open any card with `?debug=1`
and nudge the four numbers per side in `js/config.js`:

```js
export const CARD_LAYOUT = {
  front: { x0: 0.424, y0: 0.415, x1: 0.838, y1: 0.865 },
  back:  { x0: 0.466, y0: 0.205, x1: 0.842, y1: 0.752 },
};
```

They're fractions of the card's width and height. Reload to see the change.

Text auto-shrinks to fit — a long message gets smaller rather than overflowing,
down to the floor set by `TYPE.minSize`.

---

## About the "Add to Apple Wallet" button

There isn't one, and that's deliberate. A real `.pkpass` file has to be
cryptographically signed with a certificate that only comes with an Apple
Developer Program membership ($99/year), and signing has to happen on a server —
it cannot be done in the browser. Without the certificate, iOS refuses the file.

So the button says **Save to Photos** instead. On an iPhone it opens the native
share sheet with *Save Image* right there, which puts the card in the camera
roll. On desktop it downloads a PNG. Both sides are stacked into one image.

If you ever do buy the membership, adding a real Wallet pass means: exporting a
Pass Type ID certificate as `.p12`, adding one serverless function under `api/`
using `passkit-generator`, and pointing one more button at it. Nothing in the
current build gets in the way.

---

## Re-slicing the artwork

Only needed if you re-export the design. The current crops were measured off the
original and are baked into `tools/slice-art.mjs`:

```bash
npm i sharp
node tools/slice-art.mjs "/path/to/new-artwork.png"
```

Check `assets/card-front.png` and `assets/card-back.png` afterwards, and re-check
the safe zones with `?debug=1`.

---

## How it works

Cards are drawn on a `<canvas>`, not in HTML. That's what makes Arabic render
correctly (the browser shapes the text natively), keeps the PDF and the PNG
pixel-identical to what's on screen, and avoids the font-loading races that make
HTML-to-image tools unreliable on phones.

```
index.html      the landing page (intro, poem, sample card)
card.html       every QR code lands here — ready cards and ask cards alike
js/card-render.js   the canvas engine
js/export.js        PDF + save-to-phone
js/config.js        LinkedIn URL, titles, text safe zones
data/people.json    who gets a card (one entry per QR code)
data/poem.json      the Arabic verse on the landing page
tools/make-qrs.mjs  QR codes + printable sheet
```

---

## One routing gotcha, written down so it isn't rediscovered

In `vercel.json` the rewrite destination is `/card`, **not** `/card.html`.

`cleanUrls: true` makes Vercel 308-redirect `/card.html` → `/card`. A rewrite
whose destination is itself a redirect doesn't follow it — it just 404s. So
every slug returned "page not found" until the destination was changed to the
clean path. The local `serve.json` doesn't behave this way, so this only shows
up on the deployed site: **always open a real slug like `/besho` on the live URL
after deploying, not just the homepage.**
