# Future class registry

The full list of bash command classes registered in `pi-precognition` v0.2.

Each class declares a cache key, the command shapes the model might emit, the intent tags that trigger draft-time auto-warming, the argv used to run the command, the causal-file fingerprint scope, and whether mutation-intent should suppress auto-warming.

| Cache key | Recognized shapes | Auto-warm intents | Causal scope | Fingerprinted | Mutation-sensitive |
|---|---|---|---|---:|---:|
| `bash:npm test` | `npm test`, `npm run test`, `npm test 2>&1 \| tail -N` | `test` | package.json + lock + src/** + tests/** + test.* + *.test.* | ✓ | ✓ |
| `bash:vitest` | `vitest`, `vitest run`, `npx vitest`, `npm run test:vitest` | `test` | same as npm test | ✓ | ✓ |
| `bash:jest` | `jest`, `npx jest`, `npm run test:jest` | `test` | same as npm test | ✓ | ✓ |
| `bash:pytest` | `pytest`, `pytest -q`, `python -m pytest` | `test` | pyproject.toml + setup.cfg + pytest.ini + conftest.py + tox.ini + *.py | ✓ | ✓ |
| `bash:npm typecheck` | `npm run typecheck`, `tsc --noEmit`, `tsc -p X --noEmit`, `npx tsc --noEmit` | `build` | package.json + tsconfig + ts/tsx/d.ts files | ✓ | ✓ |
| `bash:npm lint` | `npm run lint`, `eslint`, `npx eslint .` | `build` | package.json + .eslintrc + eslint config + src/** | ✓ | ✓ |
| `bash:npm build` | `npm run build`, `npx tsc -b` | `build` | package.json + tsconfig + build config + src/** | ✓ | ✓ |
| `bash:git status` | `git status`, `git status --short`, `git status -s` | `review`, `debug` | (TTL-only, ≤ 2s) | ✗ | ✗ |
| `bash:git diff` | `git diff`, `git diff --stat`, `git diff --name-only` | `review`, `debug` | (TTL-only, ≤ 2s) | ✗ | ✗ |
| `bash:git log` | `git log`, `git log --oneline -n N`, `git log -N` | `review`, `debug` | (TTL-only, ≤ 2s) | ✗ | ✗ |
| `bash:cat package.json` | `cat package.json` | `review`, `build` | (TTL-only, ≤ 2s) | ✗ | ✗ |
| `bash:ls` | `ls`, `ls -la`, `ls src`, `ls -la src` | `review`, `debug` | (TTL-only, ≤ 2s) | ✗ | ✗ |
| `git_status_short:status --short` | _legacy hidden-context output of `warmGhostTools`_ | (internal) | (TTL-only) | ✗ | ✗ |
| `git_diff_name_only:diff --name-only` | _legacy hidden-context output of `warmGhostTools`_ | (internal) | (TTL-only) | ✗ | ✗ |

## Read classes (non-bash)

Read futures aren't enumerated as command classes; they're keyed dynamically by repo-relative path under `read:<relativePath>`. Each is fingerprinted by the file's mtime + size at warm time and re-validated at serve time.

## How auto-warming triggers

The runtime extracts intent tags from the operator's draft text using regex over a fixed vocabulary:

```
test    → /\b(test|tests|spec|failing|vitest|jest|playwright|pytest|unit|e2e)\b/i
build   → /\b(build|compile|tsc|bundle|lint|typecheck)\b/i
debug   → /\b(debug|trace|crash|stack|error|regression|bug|fix)\b/i
review  → /\b(review|audit|diff|pr|risk|regression)\b/i
perf    → /\b(perf|speed|latency|slow|benchmark|p95|p50)\b/i
docs    → /\b(readme|docs|document|paper|arxiv|writeup)\b/i
```

Each command class's `intentTags` field lists which of these triggers auto-warm. When the draft has a mutation verb (`fix`, `edit`, `refactor`, ...), classes marked `mutationSensitive: true` are suppressed even if their intent tag matches — see `docs/safety-model.md` for the rationale.

## Adding a class

See [`docs/build-a-future.md`](./build-a-future.md). New classes land via PR with the full safety + benchmark receipt set.

Open class slots (Cargo, Go, Maven, Gradle, Bazel) tracked in [`challenges/leaderboard.md`](../challenges/leaderboard.md).
