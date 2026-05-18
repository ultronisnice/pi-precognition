# pi-blitz × pi-precognition v0.3 demo

**One sentence:** while you draft an edit, precognition learns the symbolic-edit rhythm — armed `pi_blitz:edit` and `pi_blitz:batch` futures — and the Pattern Library shows you the model of your editing style.

## Why this is the combo

- **pi-blitz** is a fast, symbol-anchored AST edit blade.
- **pi-precognition v0.3** observes which edits you keep making and warms the futures you're most likely to fire next.
- Together: anticipated symbolic edits, not anticipated text typing.

## Reproducing the demo (45 seconds)

The pi-precognition repo seeds itself naturally during normal use. To show it cold from scratch:

```bash
cd <repo>
node ./src/cli.ts doctor
```

Then run the seeded transcript (already captured during T-003 GREEN):

```bash
cat docs/v0.3-pi-blitz-transcript.txt
```

## Live transcript (real output)

After three `test-after-edit` observations on `src/cli.ts` and two `build/typecheck-preflight` observations on `src/pattern-library.ts`, with two hits recorded against `bash:npm test` and one against `bash:npm run typecheck`:

```
Pattern Library · 2 patterns · your-project
  totals: 3 hits / 8 armed · saved 32.7s
- test-after-edit · count 3 · conf 0.59 · saved 24.3s · hit-rate 33% (2 of 6 hits) · pi_blitz:edit a3/h0/r0, bash:npm test a3/h2/r0
  refs: src/cli.ts
- build/typecheck-preflight · count 2 · conf 0.51 · saved 8.4s · hit-rate 50% (1 of 2 hits) · bash:npm run typecheck a2/h1/r0
  refs: src/pattern-library.ts
```

Read line 1: **`pi_blitz:edit a3/h0/r0`** — the engine learned that whenever a `test-after-edit` pattern fires on `src/cli.ts`, `pi_blitz:edit` is one of the futures that should be armed. The hit count is 0 because the toolchain hasn't actually invoked `pi_blitz:edit` against this learned pattern yet — that wiring happens at the extension boundary, not in the CLI dog-food path.

When `watch` ticks, the live arming layer prints exactly which expensive futures are armed and which were rejected with reasons:

```
3:05:09 am · mutation#1 changed=0 +0/-0 ~0 · top=test-after-edit · armed=pi_blitz:edit · saved=0ms
  armed: bash:npm test, bash:npm run typecheck
  rejected: bash:npm run lint — no scripts.lint in package.json
  rejected: bash:npm run build — no scripts.build in package.json
```

That is the combo. The Pattern Library is the personal model. The mutation stream is the trigger. `pi_blitz:edit` is the future that gets warmed when the operator's rhythm says "edit + test" is about to happen.

## What is honest, what is not

**Honest claims:**
- `pi_blitz:edit` and `pi_blitz:batch` are registered as built-in future classes (see `src/future-compose.ts`).
- The Pattern Library tracks armings, hits, misses, rejections, and saved-ms for each future key, including `pi_blitz:*` keys.
- The renderer surfaces those counts by name in the `patterns` output, pinned by `tests/v03-pi-blitz-demo.test.mjs`.

**Not claimed:**
- The CLI does NOT execute `pi_blitz_edit` for you. pi-blitz is a separate tool; precognition only warms its anticipation graph.
- "Likely exact refactor" is *probabilistic*, not deterministic. The engine emits a confidence score and the operator decides.

## Surface area for extension authors

Every pattern in the Library exposes a stable shape (`futures[].key`, `futures[].armed/hits/misses/rejections/savedMs`). External future classes can land via `registerFutureClass({ key, label, kind, match, describe, ... })` and immediately appear in the same operator-readable summary line.
