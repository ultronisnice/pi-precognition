# Build a future

A **future** is a safe, validated prediction of a tool result.

This document shows how to add a new future class to `pi-precognition` in ~15 minutes.

## Anatomy of a future class

Every future class declares five things:

1. **Cache key** — canonical identifier (`bash:cargo test`)
2. **Command shapes** — regex patterns the model might emit (`/^cargo test(?:\s|$)/`)
3. **Safety class** — read-only? mutation-sensitive?
4. **Causal fingerprint** — which files in the workspace, if changed, must invalidate this future
5. **Run argv** — how to actually execute the command at warm time

The runtime handles everything else: draft-time observation, fingerprint collection, mtime/size/sha1 validation, serve-on-explicit-request, fallback on mismatch.

## A new future class in 30 lines

Suppose you want `pi-precognition` to warm `cargo test` for Rust repos.

Today the registered classes live in `src/core.ts` under `COMMAND_CLASSES`. Adding one is a single entry:

```ts
{
  key: "bash:cargo test",
  label: "cargo test",
  patterns: [
    /^cargo test(?:\s|$)/,
    /^cargo test 2>&1 \| tail -\d+$/,
  ],
  intentTags: ["test"],
  runArgv: ["cargo", ["test", "--quiet"]],
  isFingerprinted: true,
  mutationSensitive: true,
  causalFilter: (paths) => paths.filter((p) =>
    /^(Cargo\.toml|Cargo\.lock|src\/.*\.rs|tests\/.*\.rs|benches\/.*\.rs)$/.test(p)
  ),
  precondition: (cwd, _pkg) => {
    // Only warm if a Cargo.toml exists in the repo root
    return existsSync(join(cwd, "Cargo.toml"));
  },
  timeoutMs: 30000,
}
```

That's it. The runtime takes care of:

- Watching draft text for "run cargo test" / "cargo test failed" / similar intent
- Re-running the causal filter at draft time, computing sha1+size+mtime for each Rust source file
- Executing `cargo test --quiet` in the background during operator typing
- Re-validating the fingerprint when the model later calls `bash("cargo test")`
- Serving the cached output **only** if the fingerprint still matches
- Falling through to the real `cargo test` on mismatch

## Safety requirements

Before your class is accepted into the registry, it must satisfy:

- **I3. No mutation speculation** — `runArgv` may not invoke mutating commands (`cargo install`, `cargo publish`, etc.). Read-only inspection only.
- **I4. Causal-fingerprint validation** — `causalFilter` must capture every file whose change would invalidate the result. If you forget tests/, the model will get stale test output after edits.
- **I5. Repo-local only** — `runArgv` must operate against `cwd`, never write outside it.
- **Precondition gate** — `precondition` must reject when the workspace can't actually run the command (no Cargo.toml → no warming attempts).

Optional but recommended:

- **Mutation suppression** — set `mutationSensitive: true` for diagnostic classes (tests, typecheck, lint, build). When the operator's draft contains a mutation verb (`fix`, `edit`, etc.), auto-warming is suppressed to prevent the "check-fix-recheck" seduction (see `docs/safety-model.md`).

## Submitting your future

A valid PR contains:

```
src/core.ts           ← your new COMMAND_CLASSES entry
tests/<class>.test.mjs ← unit test: pattern match + safety gate + fingerprint diff
docs/future-classes.md ← entry in the registered-classes table
challenges/leaderboard.md ← entry with workload + measured wait saved + safety pass
validation/<class>-<timestamp>.md ← reproducible bench artifact
```

See `examples/cargo-future-class/` for a complete worked example.

## Five-line safety checklist

Every future class PR must pass:

1. **Pattern test** — `findCommandClass("cargo test").key === "bash:cargo test"`
2. **Negation test** — `findCommandClass("cargo publish") === undefined`
3. **Fingerprint test** — modifying a `src/**/*.rs` file invalidates the future
4. **Secret refusal** — adding `.env` or `Cargo.toml.private` to the causal scope is rejected
5. **Precondition test** — running in a repo without `Cargo.toml` returns no future

Templates in `tests/` show the exact shapes.

## What makes a good future

A future class is worth shipping if **all four** are true:

1. **Recurring** — the model calls it more than once per session in real workloads.
2. **Slow** — cold latency is at least 200ms. Below that, the warm overhead doesn't pay off.
3. **Deterministic** — same inputs → same output, modulo the causal scope you declare.
4. **Safe** — read-only, no mutating side effects, no secret-path reads.

If your candidate fails any of these, it's not a future class — it's noise.

## The receipt rule

When the model serves your future, the operator should see a receipt line like:

```
precog ✓ bash:cargo test · 12.3s → 800ms · fingerprint ok
```

That receipt is the proof. Every PR adding a future class should include a screenshot or recorded artifact of this line firing on the workload your class targets.

> Build a future. Submit a receipt.
