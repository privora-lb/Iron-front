# Testing

There is one test command and it is not a unit-test runner:

```bash
npm test          # build the headless bundle, then run all 51 checks
npm run test:fast # shorter match runs, for a tight loop
npm run test:sim  # one determinism probe, prints hashes as JSON
npm run test:crowd # how many bodies are standing inside each other
```

## What the harness is

`test/dom.js` implements just enough DOM — elements, events, a canvas context
that records nothing, `localStorage`, timers, `requestAnimationFrame` — to boot
the real game inside `vm.createContext`. No jsdom, no browser, no dependencies.
`test/harness.js` then drives it.

Because the game moved from one inline `<script>` to ES modules under `src/`,
the harness can no longer read the code straight out of `index.html`. It loads
`dist-test/iron-front.iife.js` instead — one self-executing bundle built from
`src/headless.js` by `npm run build:test`, which every test script runs first.
The body markup still comes from the real `index.html`, so the HUD the tests
click on is the HUD that ships.

## The nine checks

1. **LOAD** — the bundle evaluates with no error, the debug hooks are installed,
   the palette is built, and 30 idle frames run on the start screen. This is the
   check that catches the black-screen-on-launch class of bug.
2. **MATCH** — a full match on each of the five battlefields, through the real
   animation-frame path so `draw()` runs too.
3. **UI** — every button in every phase is clicked, and every palette card is
   selected. Catches handlers that throw on an element that moved.
4. **DETERMINISM** — two separate Node processes run the same seed for the same
   number of ticks and must agree on `stateHash()`. Driven by tick count alone,
   never by wall clock.
5. **WORLD** — trees, villages and civilians hold together, and killing every
   civilian leaves `stateHash()` untouched.
6. **FEEL** — the camera punches and settles; a finger can select several units.
7. **SAVES** — a battle is saved in one Node process and loaded in another, and
   must come back on the same `stateHash()` and then run on identically. Also
   the slot limit, and that a record this build cannot read is refused rather
   than half-loaded.
8. **TERRAIN** — the battlefield model. `test/terrainrun.mjs` imports
   `src/world/terrain.js` directly, with no DOM and no engine, and asks it
   about ground laid out by hand: a wood here, a building there, a hill
   behind. The rest of the section checks a real battle reads the same model —
   roads carry armour, a collapsed house leaves rubble armour must go round,
   and the info line says what the simulation is using.
9. **RENDERERS** — the same battle can be drawn two ways. The 3D ground is
   laid over the battlefield the right way round, a device with no WebGL is
   refused the 3D view and keeps playing, and both renderers read one world
   rather than a copy each. The section also asks a question that sounds like
   taste and is not: **does the ground reflect a believable amount of light?**
   Grass, soil, stone and made roads all return between a tenth and a third of
   what lands on them, and only snow gets near four fifths. `albedorun.mjs`
   builds each battlefield's ground and measures it, one river bank at a time,
   because a bright snowfield on one bank would otherwise hide a blown-out farm
   on the other. Ground authored above those figures cannot be lit to look like
   ground — turn the sun down until it stops glaring and the sky goes out with
   it — and that is precisely the state every map was in while its palette was
   being handed to a physical renderer as reflectance without ever being
   converted out of sRGB.

## Testing a renderer with no screen

The harness has no WebGL, so the 3D renderer can never start there — and
`vite.config.test.js` aliases it to `test/no-three.mjs` so three.js is not
bundled into every test run. What can still be tested is the geometry: three
builds meshes perfectly well in Node, it only needs a browser to draw them.
`test/terrain3drun.mjs` imports the ground builder directly and proves the
mesh lies over the battlefield the right way round — the failure that would
otherwise look like "the terrain is a bit odd" in a screenshot, while every
unit stood in the wrong place on it and picking was wrong everywhere.

## Why saves are driven by tick count too

The frame loop accumulates real elapsed time, so how many ticks a frame runs
depends on the absolute wall clock. Two instances at different clock readings
will eventually run a different number of ticks in the same frame and drift
apart, save or no save. `test/saverun.js` therefore drives by tick count, the
same way `test/simrun.js` does.

## The rule when you change the engine

Check 4 is the one that matters during the extraction work in
[EXTRACTION.md](EXTRACTION.md). A refactor that is supposed to move code without
changing behaviour must leave the checkpoint hash **identical**:

```bash
npm test 2>&1 | grep "last hash"
```

If the hash moves and you did not intend it to, the refactor changed the
simulation. If the hash moves and you _did_ intend it — a balance change, a new
rule — record the new hash in the commit message so the next regression is
bisectable.

## The crowding probe

`test/crowdrun.js` answers a question that is easy to assert and hard to see by
eye in a battle of four hundred men: are units walking through each other? It
reports `pairs` (how many overlapping pairs exist) and `worstFrac` (the deepest
overlap as a fraction of the two bodies' combined radius) at fixed tick counts.

It is a measurement, not a pass/fail gate — crowds at a bridgehead legitimately
press together. Use it to compare before and after when you touch `separate()`,
`accel()` or the formation spacing.

## The stuck-unit probe

`test/stuckrun.js` counts bodies standing where they are not allowed to stand.
Pass `--buy tank,apc,howitzer,mlrs` to exercise the mid-battle reinforcement
path, which spawns at a base through `hqSpawn()` and is where units used to
land inside a building and never move again.

A count that does not fall to zero within a few hundred ticks is a body that is
trapped for good. It should read zero.

## Screenshots

`test/shot.js` boots the same engine against a REAL canvas and writes a PNG.
The harness canvas records nothing, so the suite can prove `draw()` does not
throw but never what the screen looks like - and questions like "why does the
map look like a board game" cannot be answered any other way without a browser.

```bash
npm i --no-save @napi-rs/canvas   # tens of MB of binary; not a dependency
npm run shot
node test/shot.js out.png --map city --hour night --zoom 3
```

It drives the real interface - map picker, hour picker, deploy, the HUD zoom
button - so what it captures is a real match, not a staged scene. Two habits
worth keeping: rebuild first (it loads `dist-test/`, so an unbuilt change shows
nothing and looks like a failed fix), and shoot before AND after, because the
things that make a scene look wrong are rarely the things you would guess.

## What is not covered

Rendering correctness. The suite's canvas is a stub, so it proves `draw()` does
not throw, not that it draws the right thing — use `npm run shot` above and look
at the result. Also touch gestures, the native shell, and the service worker.
Those need a real browser; Playwright against `npm run preview` is the obvious
next step and is on the roadmap.
