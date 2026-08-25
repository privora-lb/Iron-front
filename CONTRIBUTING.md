# Working on Iron Front

```bash
npm install
npm run dev        # http://localhost:5173, and on your phone via the Network line
npm test           # 18 checks, including determinism across processes
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first — the layering and the
two load-bearing rules (determinism, fixed timestep) are the things that are
easy to break without noticing.

## Before you push

```bash
npm run check      # lint + test + build
```

## Where to make a change

| You want to                        | Edit                                                          |
| ---------------------------------- | ------------------------------------------------------------- |
| Rebalance a unit                   | `src/data/units.js`                                           |
| Add or retune a battlefield        | `src/data/maps.js`, then the `gen*` functions in `engine.js`  |
| Change the rank ladder or XP curve | `src/data/ranks.js`                                           |
| Tune the AI's aggression           | `src/data/difficulty.js`                                      |
| Restyle the HUD                    | `src/styles/hud.css`                                          |
| Add native behaviour               | `src/platform/native.js` — and make sure it no-ops on the web |
| Split up the engine                | Follow [docs/EXTRACTION.md](docs/EXTRACTION.md) exactly       |

## House style

- No runtime dependencies in the game itself. The whole point is that a match
  runs on a five-year-old phone with no network.
- `src/game/engine.js` is exempt from Prettier and from most lint rules while it
  is being split. Do not reformat it; a moved block and a reformatted block in
  the same diff cannot be reviewed.
- New code outside the engine follows Prettier and the flat ESLint config.
- Comments explain _why_. The existing engine comments are terse and dry; match
  that rather than annotating the obvious.

## Commits that touch the simulation

Include the determinism hash:

```bash
npm test 2>&1 | grep "last hash"
```

If the hash changed, say so in the commit message and say why. A silent hash
change is the one thing that makes a regression hard to find later.
