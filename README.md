# Iron Front

A two-nation modern warfare strategy game. Valenmark (blue) defends; Rothal
(red) invades. Runs in a browser, installs as a PWA, and ships as an Android and
iOS app from the same bundle.

```bash
npm install
npm run dev        # play at http://localhost:5173
```

## The game

You start at Recruit with 300 coins and earn both coins and experience from
kills. Ranks run to Supreme Commander at level 1000, unlocking heavier units,
larger formations and a bigger command as you climb.

- **Five battlefields:** River Villages, Mountain Pass, Landing Beach, City
  Ruins, Desert Wadi
- **Units:** infantry, elite, engineers, snipers, AT, AA, gunships, tanks,
  mortars, rockets, howitzers, MG teams, APCs
- **Engineers** dig trenches, wire, sandbags and minefields along lines you draw
- **Five bases a side** to hold and take, plus territory blocks that change hands
- **Fog of war** over enemy ground; your own half is always clear
- **Difficulty:** Easy, Normal, Hard, and Adaptive — which grows stronger every
  minute
- **Total War** removes every limit

Controls: tap a unit card then the ground to deploy · tap markers to select ·
tap ground to move · tap an enemy to engage · number keys 1–9 for groups ·
right-click cancels · pinch, wheel or the +/− buttons to zoom · tap the round
minimap to jump.

## Commands

|                   |                                                         |
| ----------------- | ------------------------------------------------------- |
| `npm run dev`     | Dev server, reachable from a phone on the same network  |
| `npm run build`   | Production build into `dist/`                           |
| `npm run preview` | Serve the production build                              |
| `npm test`        | The headless harness — 18 checks, including determinism |
| `npm run check`   | Lint, test and build, as CI runs them                   |
| `npm run icons`   | Regenerate every icon size from the procedural emblem   |
| `npm run android` | Build, sync and open Android Studio                     |
| `npm run ios`     | Build, sync and open Xcode                              |

## Layout

```
index.html            the app shell — markup only
src/
  main.js             entry: polyfills → native shell → game → service worker
  headless.js         the same engine, bundled for the test harness
  data/               balance and content as plain values — units, maps, ranks
  core/               seeded rng, math, dom, polyfills
  game/engine.js      simulation, renderer, HUD, input (being split up)
  platform/           Capacitor bridge, storage, service worker registration
  audio/sound.js      synthesised sound effects — no sample files
  styles/             tokens, HUD, panels, overlays, safe-area, fonts
public/               manifest, service worker, icons, fonts — copied verbatim
test/                 headless DOM and the harness that drives the game
scripts/gen-icons.mjs dependency-free PNG icon generator
docs/                 architecture, extraction plan, mobile, testing, roadmap
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — layers, and the two rules that are
  load-bearing
- [Extraction plan](docs/EXTRACTION.md) — how `engine.js` gets broken up, in
  order
- [Mobile](docs/MOBILE.md) — Capacitor setup, live reload on a device, release
  checklist
- [Testing](docs/TESTING.md) — what the harness covers and what it cannot
- [Roadmap](docs/ROADMAP.md) — what stands between here and a finished product
- [Contributing](CONTRIBUTING.md) — where to make a change

## Deploying the web build

**Render** reads `render.yaml`: build `npm ci && npm run build`, publish `dist`.
Every push to the branch redeploys, and pull requests get previews.

**Anywhere else** — Netlify, Vercel, GitHub Pages, Cloudflare Pages — the recipe
is the same: build command `npm run build`, publish directory `dist`. Serve
`/assets/*` with a long cache and `index.html`, `sw.js` and
`manifest.webmanifest` with `no-cache`.

## Saved data

Your commander name, rank, record and best score are kept in browser storage,
per origin. A local copy and a hosted copy keep separate records; an installed
app keeps its own again.
