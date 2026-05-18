# Changelog

All notable changes to `pi-precognition` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows semantic versioning.

## [0.3.0] — 2026-05-19

The Personal Anticipation Engine release. v0.2.0 proved validated
futures are safe; v0.3.0 makes them **personal, visible, and reactive**.

### Added

- **Persistent Pattern Library.** A per-project ranked store of operator
  rhythm patterns, persisted at `.pi-precognition/patterns.json`. Survives
  cold-start; reads operator-English by default (`pi-precognition patterns`).
- **Live mutation stream.** Bounded file-change tracker. The new
  `pi-precognition watch` command and `patterns --live` re-evaluate
  expensive futures on every file change and print human-readable
  rejection reasons (e.g. `rejected: bash:npm run lint — no scripts.lint
  in package.json`).
- **Anticipation Planner.** Budget-bounded planner (~40 ms by default)
  that reads the pattern library + latest mutation event and produces a
  boost plan the warming path consumes. Never throws; a stale plan reduces
  to the v0.2 evidence flow.
- **`pi-blitz` future classes.** Symbolic AST edit/batch/apply candidates
  are now first-class learned futures, surfaced by name in `patterns`
  output.
- **Future Compose API.** Third-party packages can register safe future
  classes in under 30 lines. See `examples/rust-cargo-check/` for a
  non-trivial worked example.
- **New CLI surfaces.** `doctor`, `patterns`, `patterns --live`, `watch`,
  and `bench --paired`. The paired bench writes Markdown + raw JSON
  receipts to `validation/`.
- **Community surface.** `ULTRXN.md` doctrine, `docs/build-a-future.md`
  30-line anatomy, `challenges/` (three open challenges + leaderboard),
  `.github/` PR + issue templates for benchmark receipts, new future
  classes, and safety bypass reports.
- **30-sample paired-benchmark evidence.** 14 receipts under `validation/`
  across three real projects. See `validation/v0.3-evidence-report.md`.

### Changed

- `package.json` `files` widened to include `docs/`, `examples/`,
  `validation/`, `SECURITY.md`, `CHANGELOG.md`.
- `package.json` gains `doctor`, `bench`, `patterns` scripts and a `bin`
  entry for `pi-precognition`.
- `src/index.ts` additively wires the new modules on session start. The
  v0.2 silent-futures default, ghost-tool secret denylist, symlink
  containment, and hard off-switch (`PI_PRECOG=0`) are unchanged.

### Known limitations

Carve-outs called out plainly so the headline numbers can't be misread:

- `slow-command` is a synthetic 5-second deterministic stand-in, not a
  real npm workload. Real cold typecheck/test numbers are the headline;
  `slow-command` is reported as the upper-bound demonstration.
- Benchmarks are local single-machine; no CI parity claim.
- Pattern Library shows 0 persisted in bench output because the CLI
  doesn't invoke `primeDraftFutures` — only the extension path does.
- `pi-blitz` patterns appear only when seeded with `observePattern`,
  same code path as the extension.
- No GitHub Agentic Workflow yet — deferred to v0.3.1.

### History rewrite + leak scrub

Before this release was prepared, all commits up to and including the
public `v0.2.0` tag had their commit *messages* rewritten via
`git filter-branch --msg-filter` to remove two incidental identity
strings (a personal handle and a superseded legacy codename) that
appeared inside leak-scan boast lines. No source file content changed;
only commit-message text.

Consequences and details — including new SHAs, the `--force-with-lease`
push, the npm package being unaffected, and the GitHub gc window — are
documented in `.github/HISTORY.md`.

This is called out here so the public history change isn't quiet
revisionism. The receipts standard applies to the project's own
history-keeping, not just its features.

### Safety

The v0.2.0 safety surface is preserved as a strict superset. Every
public invariant (silent-futures default, secret denylist, symlink
containment, hard off-switch) is re-verified by the unchanged v0.2 test
suite. See `docs/v0.3-reconciliation.md` for the file-by-file audit.

## [0.2.0] — 2026-05-16

Validated tool futures with receipt vocabulary. See the v0.2.0 tag
message and `docs/safety-model.md` for the v0.2 contract.

[0.3.0]: https://github.com/ultronisnice/pi-precognition/releases/tag/v0.3.0
[0.2.0]: https://github.com/ultronisnice/pi-precognition/releases/tag/v0.2.0
