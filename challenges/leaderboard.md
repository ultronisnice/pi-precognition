# Future class leaderboard

Receipts over claims. To add a row: open a PR with a complete future class (see `docs/build-a-future.md`).

PR must include:

- future class entry in `src/core.ts`
- pattern + negation + fingerprint + precondition tests in `tests/`
- entry in `docs/future-classes.md`
- a reproducible artifact in `validation/`
- this leaderboard row

| Future class | Contributor | Workload | Cold wait | Warm wait | Saved | Safety | Artifact |
|---|---|---|---:|---:|---:|---|---|
| `bash:npm test` | ULTRXN | slow-command (15s sleep) | 15,234ms | 29ms | **15.2s** | pass | [link](../validation/precog_live_ab_2026-05-15T05-57-56-215Z.md) |
| `bash:npm typecheck` | ULTRXN | tsc on lab repo (~2s) | TBD | TBD | TBD | pass | TBD |
| `read:src/<file>` | ULTRXN | first-tool read | ~50ms | ~5ms | **45ms** | pass | (microbenchmark, see `docs/benchmarks.md`) |
| `bash:cargo test` | _open_ | TBD | TBD | TBD | TBD | TBD | TBD |
| `bash:go test` | _open_ | TBD | TBD | TBD | TBD | TBD | TBD |
| `bash:pytest` | ULTRXN | _registered, untested at scale_ | TBD | TBD | TBD | TBD | TBD |
| `bash:mvn test` | _open_ | TBD | TBD | TBD | TBD | TBD | TBD |
| `bash:gradle test` | _open_ | TBD | TBD | TBD | TBD | TBD | TBD |
| `bash:bazel test` | _open_ | TBD | TBD | TBD | TBD | TBD | TBD |

## Open class slots

Pick one and ship it:

- **`bash:cargo test`** — see `examples/custom-future-class/` for the worked template
- **`bash:go test`** — Go module + test discovery
- **`bash:pytest`** registered but lacks a published artifact; first to bench it gets the row
- **`bash:mvn test`** — Maven; respect `pom.xml` + `src/main` + `src/test`
- **`bash:gradle test`** — Gradle; respect `build.gradle` + `settings.gradle` + sources
- **`bash:bazel test`** — Bazel; the causal scope is non-trivial, this is the hardest one

## Stale rejection benchmark (separate column, separate game)

A second leaderboard tracks **safety**: which future classes correctly invalidate when the causal scope changes?

| Class | Mutation test | Stale rate after edit | False-serve count |
|---|---|---:|---:|
| `bash:npm test` | edit src/api.ts then run npm test | 0% | 0 |
| `read:src/<file>` | overwrite the file | 0% | 0 |

Future classes that show >0% false-serve under a fingerprint test fail safety and don't ship.
