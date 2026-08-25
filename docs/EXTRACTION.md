# Breaking up `engine.js`

`src/game/engine.js` is ~3,900 lines and still holds the simulation, the
renderer, the HUD and the input layer in one closure. The data tables and the
leaf helpers are already out. This is the plan for the rest, in the order that
takes the least risk.

## Why it is still one file

Everything in it shares one scope, and a large amount of that shared state is
reassigned, not mutated — `squads=[]`, `cam={...}`, `ground=null`. An ES module
cannot reassign an imported binding, so you cannot lift those declarations out
one at a time without first giving them a home. That home is the next step.

## Step 1 — a state module (do this first, everything else depends on it)

Move the reassigned top-level `let`s into `src/game/state.js` as fields of one
exported object:

```js
export const S = {
  squads: [],
  soldiers: [],
  shots: [] /* … */,
  phase: 'start',
  paused: false,
  battleTime: 0,
  cam: { s: 1, x: 0, y: 0 },
};
```

Then `squads` becomes `S.squads` throughout. It is a mechanical rename, it is
large, and it must be done in one commit with a green harness run on both sides
of it. Nothing below can start until it lands.

## Step 2 — the leaves, in this order

Each is a section banner in `engine.js` today. Sizes are approximate current
line counts; extract from the bottom of the list up, because the later entries
have the fewest inbound references.

| Order | Section (line banner)                  | Lines | Goes to                | Notes                                                                                                            |
| ----- | -------------------------------------- | ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1     | `unit icons`                           | ~90   | `src/render/icons.js`  | Pure drawing from a key and a colour. No state at all — this one can move today, before step 1.                  |
| 2     | `terrain generation`                   | ~515  | `src/world/terrain.js` | Needs the terrain grids with it. Writes grids, reads only `mapType` and the RNG.                                 |
| 3     | `terrain grids`                        | ~65   | `src/world/grids.js`   | The typed arrays and the `gi`/`terrainAt`/`solid` accessors.                                                     |
| 4     | `particles, decals, fire`              | ~245  | `src/fx/`              | Split into `particles.js`, `decals.js`, `fire.js`. Cosmetic — uses `vr()`, not the seeded RNG.                   |
| 5     | `rendering`                            | ~845  | `src/render/`          | The largest single win. Split by pass: `world.js`, `units.js`, `structures.js`, `minimap.js`, `fog.js`.          |
| 6     | `HUD`                                  | ~140  | `src/ui/hud.js`        | Reads state, writes DOM. Should end up the only file that touches the HUD elements.                              |
| 7     | `input`                                | ~405  | `src/input/`           | `pointer.js`, `keyboard.js`, `gestures.js`. Extract last: it reaches into more of the engine than anything else. |
| 8     | `simulation`                           | ~595  | `src/sim/`             | `squad.js`, `soldier.js`, `combat.js`, `steering.js`.                                                            |
| 9     | `deployment`, `phases`, `orders`       | ~350  | `src/match/`           | Match flow: muster, orders, victory.                                                                             |
| 10    | `grid`, `squads`, `walls`, `the keeps` | ~170  | `src/sim/`             | Small; fold in as their neighbours move.                                                                         |

What remains in `engine.js` afterwards is the frame loop and the wiring — a few
hundred lines. At that point rename it `src/game/loop.js` and delete the
compatibility shim.

## The rule for every one of these commits

Run `npm test` before and after. All 18 checks must pass, and the determinism
checkpoint hash must be **identical** on both sides — if the hash moves, the
extraction changed behaviour and the commit is wrong, however innocent it looks.

```
npm test 2>&1 | grep "last hash"
```

Record the hash in the commit message. That makes a regression bisectable.

## What not to do

- Do not reformat while extracting. A moved block and a reformatted block in the
  same diff is unreviewable — that is why `src/game/engine.js` is in
  `.prettierignore` and has its own ESLint relaxations.
- Do not turn a `let` into a module export and hope. See step 1.
- Do not introduce a class hierarchy on the way out. The squads and soldiers are
  plain objects in typed-array-adjacent hot loops, and they are fast because of
  it.
