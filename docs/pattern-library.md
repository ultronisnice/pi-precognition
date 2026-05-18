# Pattern Library

v0.3 adds a persistent per-project Pattern Library at `.pi-precognition/patterns.json`.

It records the operator rhythm:

- path/edit patterns (`src/core.ts` + `test-after-edit`)
- future classes armed (`bash:npm test`, `bash:npm typecheck`, `pi_blitz:edit`)
- hit/miss/rejection counts
- saved milliseconds
- last rejection reason

Commands:

```bash
pi-precognition patterns
pi-precognition patterns --live
```

`patterns --live` combines persisted patterns with the mutation stream so the display changes as files enter or leave `git status --short`.

## What v0.3 changed (operator-readable signals)

v0.3 makes the Pattern Library *feel* like a personal model, not a debug dump.

1. **Library-wide usefulness summary** — first line under the count, e.g. `totals: 3 hits / 8 armed · saved 32.7s`.
2. **Per-pattern hit-rate badge** — every pattern with at least one hit prints `hit-rate 75% (3 of 4 hits)`.
3. **Cross-session reads** — `patterns --cwd <path>` works against any seeded `.pi-precognition/patterns.json` without needing a live PrecogState, so the same model is readable from cold start.
4. **Ranking by utility, not noise** — `scorePattern = count*confidence + hits*2 + saved/1000 - rejections` — a high-confidence noise pattern with no hits ranks below a low-count pattern with real hits and saved seconds. This was preserved verbatim from earlier v0.3; the new tests pin it down at the public-CLI boundary so it cannot silently regress.

Live transcript (real `node ./src/cli.ts patterns` output after a short seed of npm test + typecheck observations):

```
Pattern Library · 2 patterns · your-project
  totals: 3 hits / 8 armed · saved 32.7s
- test-after-edit · count 3 · conf 0.59 · saved 24.3s · hit-rate 33% (2 of 6 hits) · pi_blitz:edit a3/h0/r0, bash:npm test a3/h2/r0
  refs: src/cli.ts
- build/typecheck-preflight · count 2 · conf 0.51 · saved 8.4s · hit-rate 50% (1 of 2 hits) · bash:npm run typecheck a2/h1/r0
  refs: src/pattern-library.ts
```

Live `watch --once` reads the new top pattern:

```
2:57:39 am · mutation#1 changed=36 +36/-0 ~0 · top=test-after-edit · armed=pi_blitz:edit · saved=0ms
```

The display speaks operator English: "two patterns, three hits across eight armings, 32.7s saved, the test-after-edit pattern is converting one in three armings and the typecheck pattern is hitting half the time." That is what 9.2 feels like, not `a4/h3/r1`.

## What pins it down (public-CLI tests)

`tests/v03-pattern-library-cross-session.test.mjs` spawns `node src/cli.ts patterns --cwd <tmpdir>` against three seeded `.pi-precognition/patterns.json` fixtures:

- library-wide hits + saved-time summary
- per-pattern hit-rate badge when hits > 0
- ranking high-utility patterns above no-utility noise

These tests target only the CLI's stdout, never private state. They run with the rest of the suite under `mise run precog:dev`.
