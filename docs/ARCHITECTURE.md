# Architecture

Iron Front is a canvas game with no runtime framework. Vite bundles it, a
service worker makes it installable, and Capacitor wraps the same bundle as an
Android and iOS app. There is no server: a match is simulated entirely on the
device that plays it.

## Layers

Imports only ever point downward. Nothing in `data/` or `core/` may import from
`game/` or `platform/`, which is what keeps those modules testable in isolation.

```
  main.js / headless.js        entry points — boot order, nothing else
        │
        ├── platform/          the device: native bridge, storage, service worker
        │
        └── game/engine.js     simulation, renderer, HUD, input
                  │
                  ├── audio/   synthesised effects — no sample files
                  ├── data/    rules as plain values — units, maps, ranks
                  └── core/    leaf helpers — rng, math, dom, polyfills
```

## What lives where

| Path            | Holds                                                                                                                   | Rule of thumb                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/data/`     | Balance and content: unit stats, the five battlefields, the rank ladder, difficulty presets, engineer works, world size | Values only. No state, no DOM, no imports from anywhere but other data modules. A designer should be able to edit these without reading a line of engine code. |
| `src/core/`     | `rng.js` (the seeded xorshift the simulation runs on), `math.js`, `dom.js`, `polyfills.js`                              | Pure, tiny, no game knowledge.                                                                                                                                 |
| `src/game/`     | `engine.js` — the whole simulation, renderer and input layer                                                            | Being split; see [EXTRACTION.md](EXTRACTION.md).                                                                                                               |
| `src/audio/`    | `sound.js` — every effect synthesised at run time, rate-limited and voice-capped                                        | Draws on `Math.random`, never the seeded RNG, so it cannot perturb a match.                                                                                    |
| `src/platform/` | `native.js` (Capacitor bridge), `pwa.js` (service worker), `storage.js` (save data)                                     | Every function degrades to a no-op on the web.                                                                                                                 |
| `src/styles/`   | `base` tokens, `hud`, `panels`, `overlays`, `safe-area`                                                                 | `main.css` imports the rest; that is the only file the entry point knows about.                                                                                |
| `public/`       | Copied verbatim to the site root: manifest, service worker, icons, fonts                                                | Nothing here is hashed, so nothing here may be cached forever.                                                                                                 |

## Two rules that are load-bearing

**Determinism.** The simulation may only draw randomness from `core/rng.js`,
which is a seeded xorshift32. Two machines given the same seed and the same
number of ticks must reach the same `stateHash()` — the harness checks this
across separate processes on every run. Cosmetic randomness (smoke drift, bird
paths) uses `vr()`, which wraps `Math.random` and is deliberately _not_
reproducible; never let it decide anything the simulation reads back. The same
rule is why the mixer is safe: it is loud, it is random, and none of it is ever
read back.

**Fixed timestep.** `tick(dt)` is called with `SIM = 1/60` regardless of frame
rate; the render loop accumulates real time and drains it in whole ticks. Never
scale simulation work by the measured frame time — that is what would make a
slow phone play a different battle from a fast one.

## Entry points

- `src/main.js` — the shipped app. Polyfills, then the native shell (so the
  viewport has settled before the canvas measures itself), then the game, then
  the service worker.
- `src/headless.js` — the same engine with no stylesheet, no status bar and no
  service worker. `npm run build:test` bundles it to one self-executing script
  that `test/dom.js` evaluates in a VM against a hand-rolled DOM.

## The debug hooks

`engine.js` installs a set of `window.__*` functions. They are not a leftover —
the harness drives the game through them, and the native shell uses `__menu`
and `__pause` for the Android back button and for app backgrounding. Notable
ones: `__tick(n)` advances the simulation by tick count alone, `__hash()`
returns the state hash, `__seed(v)` fixes the match seed, `__dbg()` dumps every
live squad. Keep them working.
