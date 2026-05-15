# Safety Model

`pi-precognition` is a latency primitive that warms validated tool-result futures during draft and idle time, then serves them through the normal Pi tool path only when the model **explicitly asks** for the matching tool **and** the workspace state still validates.

This document lists the safety invariants the package enforces, the threats it considers, and the limits operators should know about before deploying it.

## Invariants (always true)

These are the rules every code path in the package obeys. They are tested under all five injection modes (silent-futures, verified-futures, cache-index, full, off).

### I1. Explicit request only
A warmed future is served only when the model calls the exact wrapped tool (`read`, `bash`, `grep`) with arguments that map to the cached key. We never insert the warmed result into the model's context without an explicit request.

### I2. No answer prediction
We predict **the wait**, not **the answer**. The package never generates assistant text, never decides what the model "would have said," never speculatively executes mutating actions. It only serves cached *tool results* the model itself requested.

### I3. No mutation speculation
Only read-only futures and an allowlisted set of read-only command futures (`npm test`, `npm typecheck`, `git status`, etc.) are ever warmed. `write`, `edit`, `bash` outside the allowlist, deletes, network calls — never speculated. There is no path by which a speculation can mutate workspace state.

### I4. Causal-fingerprint validation
Every served future re-validates at serve-time:
- **Read futures**: re-stat the file. Reject if size or mtime drifted.
- **Bash command futures (fingerprinted classes)**: re-collect causal files (`package.json`, `tsconfig`, source tree, test files) and compare sha1+size+mtime against the snapshot taken at warm time. Reject on any drift.
- **Bash command futures (unfingerprinted classes)** (`git status`, `ls`, `cat`): TTL-only, default 2 seconds.

If validation fails, the future is dropped and Pi falls through to the normal tool path. Stale futures are never served.

### I5. Repo-local only
All warmed paths must:
- Resolve to a real file inside `process.cwd()`
- Survive realpath containment after symlink resolution
- Not start with `~` or `/` (no absolute path escapes)
- Not contain `\0` or `..` traversal sequences after normalization

### I6. Secret-path denylist
The package refuses to warm or serve any path matching:
```
.env, .env.*, .npmrc, .netrc, .pypirc, *.pem, *.key, *.p12, *.pfx,
auth.json, models.json, credentials*, secrets/, .ssh/, .aws/,
.kube/, .docker/config.json, .config/gh/hosts.yml
```

### I7. Skipped trees
Never warmed or served:
```
node_modules/, .git/
```

### I8. Bounded file size
Maximum warm file size is 24 KB by default (`PI_PRECOG_MAX_FILE_BYTES`). Larger files are skipped, not truncated.

### I9. Binary refusal
Files containing a `\0` byte in the first read pass are skipped.

### I10. Hard off switch
`PI_PRECOG=0` disables everything. The package becomes a no-op extension; no warming, no caching, no overrides. The model uses normal Pi tools end-to-end.

## Threat model

The package treats **draft text** as untrusted input. It assumes:
- The operator may type adversarial path strings.
- The repo may contain symlinks pointing outside the workspace.
- Files may be modified by the operator (or another process) between warm and serve.
- The model may request paths that should never be served.

It does **not** defend against:
- A malicious extension that bypasses Pi's tool API.
- A compromised model that requests legitimate paths in a sequence designed to exfiltrate.
- A filesystem corrupted faster than `statSync` can detect.

## Command allowlist

The command-future cache only serves commands whose canonical form matches one of these registered classes:

| Class | Recognized command shapes | Causal fingerprint |
|---|---|---|
| `bash:npm test` | `npm test`, `npm run test`, `npm test 2>&1 \| tail -N` | package.json + lock + src/** + tests/** + test.* + *.test.* |
| `bash:vitest` | `vitest`, `vitest run`, `npx vitest`, `npm run test:vitest` | same as npm test |
| `bash:jest` | `jest`, `npx jest`, `npm run test:jest` | same as npm test |
| `bash:pytest` | `pytest`, `pytest -q`, `python -m pytest` | pyproject.toml, setup.cfg, pytest.ini, conftest.py, *.py |
| `bash:npm typecheck` | `npm run typecheck`, `tsc --noEmit`, `tsc -p X --noEmit`, `npx tsc --noEmit` | package.json + tsconfig + ts/tsx/d.ts files |
| `bash:npm lint` | `npm run lint`, `eslint`, `npx eslint .` | package.json + .eslintrc + eslint config + src/** |
| `bash:npm build` | `npm run build`, `npx tsc -b` | package.json + tsconfig + build config + src/** |
| `bash:git status` | `git status`, `git status --short`, `git status -s` | none (TTL ≤ 2s) |
| `bash:git diff` | `git diff`, `git diff --stat`, `git diff --name-only` | none (TTL ≤ 2s) |
| `bash:git log` | `git log`, `git log --oneline -n N`, `git log -N` | none (TTL ≤ 2s) |
| `bash:cat package.json` | `cat package.json` | none (TTL ≤ 2s) |
| `bash:ls` | `ls`, `ls -la`, `ls src`, `ls -la src` | none (TTL ≤ 2s) |

Any bash command outside this list misses the cache and runs through Pi's normal tool path.

## Mutation-intent suppression

When the operator's draft contains a mutation verb (`fix`, `edit`, `refactor`, `add`, `remove`, `rename`, `update`, `implement`, `delete`, `move`, `extract`, `inline`, `split`, `merge`, `migrate`, `rewrite`, `replace`, `insert`, `append`, `prepend`, `wrap`, `guard`, `debug`), the diagnostic command classes (`npm test`, `npm typecheck`, `npm lint`, `npm build`, `vitest`, `jest`, `pytest`) are **not** auto-warmed.

Rationale: serving a pre-mutation test result before the model has actually edited the file misleads it into a "check-fix-recheck" loop instead of the optimal "read-fix-check" loop. We learned this from n=20 paired live runs.

Explicit lookups still hit if the model asks directly and the causal fingerprint validates.

This is env-gated via `PI_PRECOG_MUTATION_SUPPRESSION` (default on; set `=0` to disable).

## Cache-invariant delay

By default, cache hits return after a small per-class delay that approximates cold-tool latency:
- `read`: 5ms
- `grep`: 80ms
- `bash`: 750ms

Why: a zero-latency cache hit *changes model behavior*. The model uses cheap tools more, which can pull it into exploration patterns that hurt task completion. Returning at cold-call latency preserves the model's tool-selection policy.

The wall-clock saving is still real: the warm itself happened during draft/idle time, so the operator-observed turn completes faster regardless of the served-call latency. The delay is a behavior-preservation device, not a speed cost.

Tunables:
- `PI_PRECOG_CACHE_DELAY_MS=N` — global default
- `PI_PRECOG_CACHE_DELAY_READ_MS=N` — per-class override
- `PI_PRECOG_CACHE_DELAY_BASH_MS=N`
- `PI_PRECOG_CACHE_DELAY_GREP_MS=N`
- Set to `0` to disable (recovers the raw-speedup mode useful for benchmarking).

## Injection modes

| Mode | What the model sees | Recommended |
|---|---|---|
| `silent-futures` (default) | Nothing hidden. Cache serves through normal tools. | **Production default** |
| `verified-futures` | Tiny receipt that futures are armed. | Diagnostic only |
| `cache-index` | Keys but not contents. | Economical context budget |
| `full` | Warmed file contents injected as a hidden custom message. | Bench/research only |

`silent-futures` is what every public number is measured against.

## Known limitations

- The package is designed for **deterministic** agent turns where the first tool call is highly predictable from the draft. It adds little value on analytical or creative turns where the model is generating content from reasoning, not retrieving.
- The static command class registry covers the JS/TS + Python + npm + git surface. Other ecosystems (Cargo, Go, Maven, Bazel) work for file reads but the bash class registry would need extension.
- The package assumes a single workspace per Pi process. Cross-repo / multi-cwd scenarios are not currently supported.

## Disabling

Multiple paths to off:
- `PI_PRECOG=0` — hard off, package becomes a no-op
- `PI_PRECOG_TOOL_CACHE=0` — keep observation only, no execution overrides
- `PI_PRECOG_COMMAND_FUTURES=0` — disable bash futures, keep read futures
- `PI_PRECOG_INJECTION_MODE=silent-futures` (default; no hidden context anyway)

## Reproducibility

All claims in the README are reproducible. See `docs/benchmarks.md`.

## Reporting a safety issue

If you find a path that violates any invariant above (e.g. a way to read a secret-path file through the cache), please open an issue with reproduction steps. The safety surface is small and we will treat any bypass as a release-blocking bug.
