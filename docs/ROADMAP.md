# Roadmap

Ordered by what unblocks the most. Everything in "Now" is a prerequisite for a
store submission that is not embarrassing.

## Now — make it shippable

- [x] **Self-host the fonts.** Done. `npm run fonts` vendors the woff2 files
      into `public/fonts/` and generates `src/styles/fonts.css`; the Google
      Fonts `<link>` tags are gone and the build makes no external request.
- [ ] **Touch controls pass on a real phone.** The game was built for a mouse
      and adapted. Audit: tap targets under 44px, the pinch-zoom versus
      drag-select conflict, and whether the unit deck is reachable one-handed.
- [x] **Sound.** Done. `src/audio/sound.js` synthesises every effect at run
      time — no audio files, nothing added to the download. Wired to gunfire,
      artillery, impacts, deployment and the end of a match, with a mute toggle
      in the pause menu. Still to do: a volume slider rather than on/off, and a
      check against the iOS silent switch.
- [x] **Settings that persist.** Done for sound, graphics, difficulty and the
      last battlefield, through `src/platform/storage.js`. Values are validated
      on read, so a setting written by an older build cannot reach the engine.
      Formation default is still per-match.
- [ ] **Orientation decision.** Lock landscape or genuinely support both. Right
      now it is neither.
- [ ] **A real emblem.** `scripts/gen-icons.mjs` draws a placeholder. Replace the
      artwork, keep the pipeline.

## Next — make it worth keeping

- [ ] **Campaign.** Five battlefields with no progression between them is a
      sandbox, not a game. A chain of missions with carried-over rank and a
      losing condition that costs something.
- [ ] **Save and resume a battle.** The simulation is deterministic and seeded,
      so a save is the seed plus the input log — small, and it doubles as a
      replay format.
- [ ] **Replays.** Falls out of the above almost free. Also the best bug report
      a player can send.
- [ ] **Tutorial.** The control list in the README is not a tutorial.
- [ ] **Balance pass against data.** `src/data/units.js` is the whole balance
      surface. Instrument win rates per unit per difficulty first, then tune.

## Later — make it a platform

- [ ] **Browser-based end-to-end tests.** Playwright against `npm run preview`:
      real canvas, real touch events, real service worker. Covers what the
      headless harness structurally cannot.
- [ ] **Multiplayer.** The determinism guarantee in
      [ARCHITECTURE.md](ARCHITECTURE.md) exists for this: lockstep over a
      relay, exchanging orders rather than state. `stateHash()` is already the
      desync detector. This is a large piece of work and should not start until
      the extraction in [EXTRACTION.md](EXTRACTION.md) is done.
- [ ] **Cloud profile.** `src/platform/storage.js` has an async-shaped API
      precisely so this is a one-file change.
- [ ] **Crash reporting on device.**
- [ ] **Monetisation.** Decide before the store listing, not after — it changes
      the rank curve.

## Engineering debt, tracked separately

The engine split has its own document: [EXTRACTION.md](EXTRACTION.md). It is
worth doing before multiplayer and before a second developer joins, and it is
not worth doing before the "Now" list ships.
