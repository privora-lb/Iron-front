# Testing

There is one test command and it is not a unit-test runner:

```bash
npm test          # build the headless bundle, then run all 39 checks
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

## The seven checks

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

## What is not covered

Rendering correctness (the canvas context is a stub — the tests prove `draw()`
does not throw, not that it draws the right thing; unit shapes were checked by
rendering the real draw code to a PNG through a native canvas, by hand), touch gestures, the native
shell, and the service worker. Those need a real browser; Playwright against
`npm run preview` is the obvious next step and is on the roadmap.
