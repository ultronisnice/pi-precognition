# Challenge 001: Add a command class

**Goal:** Add a new bash command class so the runtime can warm it for an ecosystem we don't cover today.

## Open targets

- **`bash:cargo test`** (Rust)
- **`bash:go test`** (Go)
- **`bash:mvn test`** (Java/Maven)
- **`bash:gradle test`** (Java/Gradle)
- **`bash:bazel test`** (multi-language)
- **`bash:pytest`** registered but no public artifact yet; first to bench it claims the row

## Acceptance

PR must include:

1. **The class entry** in `src/core.ts` under `COMMAND_CLASSES` — `key`, `label`, `patterns`, `intentTags`, `runArgv`, `isFingerprinted`, `mutationSensitive`, `causalFilter`, `precondition`, `timeoutMs`
2. **Tests** in `tests/<class>.test.mjs`:
   - Pattern match test (multiple shapes the model emits)
   - Negation test (similar-but-mutating commands like `cargo publish` are rejected)
   - Fingerprint test (modifying a tracked source file invalidates the future)
   - Secret-path refusal test (`.env` or credentials are filtered)
   - Precondition test (no manifest → no warming)
3. **Docs row** in `docs/future-classes.md`
4. **Leaderboard row** in `challenges/leaderboard.md`
5. **Benchmark artifact** in `validation/<class>-<timestamp>.md`

## Worked example

See [`examples/custom-future-class/`](../examples/custom-future-class/) for the `bash:cargo test` reference implementation.

## Safety bar

A class is accepted only if:

- **`runArgv` is read-only** — no `install`, no `publish`, no `deploy`, no `format --write`, no network mutation
- **`causalFilter` covers every input** the command reads — missing a source file means stale serves
- **`precondition` rejects** when the workspace can't actually run the command
- **No secret-path read** — the package's `SECRET_PATH_RE` filters before causal collection, but your filter should not be hostile to it
- **Bounded timeout** — `timeoutMs` ≤ 30,000 by default; longer needs justification

## Reward

Your name on the leaderboard. The first PR to land a class becomes the maintainer of record for that class.
