# pi-precognition

<p align="center">
  <strong>Predict the wait, not the answer.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pi-precognition"><img alt="npm" src="https://img.shields.io/npm/v/pi-precognition?color=cb3837&label=npm"></a>
  <a href="https://github.com/ultronisnice/pi-precognition/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <img alt="pi-package" src="https://img.shields.io/badge/pi--package-extension-7c3aed">
  <img alt="status" src="https://img.shields.io/badge/status-research--backed-1a73e8">
</p>

<p align="center">
  <img src="docs/demo.gif" alt="pi-precognition headline: a 15-second npm test served in 29ms through wrapped Pi-compatible tools" width="100%">
</p>

---

Validated tool futures for Pi coding agents. `pi-precognition` warms safe file, search, git, test, and typecheck results before the model waits for them — then serves only explicitly requested futures whose causal fingerprints still match.

It does not predict answers. In its default `silent-futures` mode it injects no hidden context. When tool-cache mode is on it transparently wraps Pi's `read`, `bash`, and `grep` tools — preserving their model-facing schemas and descriptions byte-for-byte — and adds a small `precognition_peek` diagnostic tool. The wait disappears; the model's tool contract does not change.

→ **[Install](#install)** · **[Reproduce](challenges/003-reproduce-the-baseline.md)** · **[Build a future](docs/build-a-future.md)**

## The number

On the slow-command workload (a `bash("npm test")` that takes 15 seconds, with 17s of draft budget), `pi-precognition` drops the blocked tool wait from **15.2 seconds to 29 milliseconds** — a **522× collapse** of the dominant latency cost.

| Metric | Baseline | With `pi-precognition` | Speedup |
|---|---:|---:|---:|
| Blocked tool wait | 15,234 ms | 29 ms | **522×** |
| First tool result | 18.4 s | 3.2 s | **5.8×** |
| Task completion | 21.9 s | 6.6 s | **3.3×** |
| Hidden injections | n/a | 0 | — |
| Quality parity | n/a | 100% | — |

**n=3 paired live runs. Boundary: deterministic-class agent turns only.** See [`docs/benchmarks.md`](docs/benchmarks.md) for the full methodology, the workload class breakdown, and what these numbers do **not** mean.

## Research framing

Tool execution can dominate agent latency. PASTE ([arXiv:2603.18897](https://arxiv.org/abs/2603.18897)) showed that speculatively executing likely next tool calls while the model reasons can cut average task completion time by 48.5%.

`pi-precognition` operates one layer earlier:

> PASTE speculates **while the model is thinking.**
> `pi-precognition` speculates **while the operator is typing.**

The two approaches compose. The package runs an allowlisted set of read-only commands (`npm test`, `npm run typecheck`, `git status`, `ls`, etc.) during operator-draft time to *warm* their results. It does **not** speculatively execute mutating actions, and it does **not** auto-decide which tool the model will call next. The model still drives every served tool call; we just had the result ready, fingerprint-validated, when it asked.


## v0.3 — Personal Anticipation Engine

v0.2 proved validated futures are safe. v0.3 makes them **personal, visible, and reactive**. It is — to our knowledge — the first public **operator-time** personal anticipation engine for coding agents: it learns your wait rhythm at the moment you draft, not after you ship.

The emotional proof is the Pattern Library. After a few sessions, `patterns` reads like an honest model of your editing style:

```
Pattern Library · 2 patterns · your-project
  totals: 3 hits / 8 armed · saved 32.7s
- test-after-edit · count 3 · conf 0.59 · saved 24.3s · hit-rate 33% (2 of 6 hits) · pi_blitz:edit a3/h0/r0, bash:npm test a3/h2/r0
  refs: src/cli.ts
- build/typecheck-preflight · count 2 · conf 0.51 · saved 8.4s · hit-rate 50% (1 of 2 hits) · bash:npm run typecheck a2/h1/r0
  refs: src/pattern-library.ts
```

That is the operator's personal model speaking back in plain English: *"two patterns, three hits across eight armings, 32.7s saved, the test-after-edit pattern converts one in three armings, the typecheck pattern hits half the time."*

New in v0.3:

- **Persistent Pattern Library** — per-project rhythm, ranked futures (`count·conf + hits·2 + saved/1000 − rejections`), hit/miss/rejection history, saved time. Stored at `.pi-precognition/patterns.json`. Survives cold-start; reads operator-English by default.
- **Live mutation stream** — `watch` and `patterns --live` re-evaluate expensive futures on every file change and print human-readable rejection reasons (`rejected: bash:npm run lint — no scripts.lint in package.json`).
- **pi-blitz future classes** — symbolic AST edit/batch/apply candidates are first-class learned futures, surfaced by name in `patterns` output.
- **Future Compose API** — third-party packages register safe future classes in under 30 minutes. See [`examples/rust-cargo-check/`](examples/rust-cargo-check/) for a non-trivial worked example.
- **Paired bench CLI** — `bench --paired` writes Markdown + raw JSON receipts to `validation/`. 30-sample evidence report at [`validation/v0.3-evidence-report.md`](validation/v0.3-evidence-report.md).

```bash
pi-precognition doctor
pi-precognition patterns           # show the personal model
pi-precognition patterns --live    # watch it react to your edits
PI_PRECOG_COMMAND_FUTURES=1 pi-precognition bench --paired --workload all --iterations 5
```

### Why operator-time matters

PASTE speculates *while the model thinks*. v0.3 speculates *while the operator types* AND learns which speculations actually paid off. The Pattern Library is the difference between a stateless cache and a personal model. The scope is narrow on purpose: this is not "AI that finishes your sentences," it is "a coding agent that learns what you usually wait on and pre-arms it safely, with receipts."

The engine never speculatively mutates. Only deterministic safe-class futures are armed (test / typecheck / lint / build / read / git). Rejection is loud and reasoned.

### v0.3 ties into self-evolving agents

A coding agent that learns the operator's wait rhythm is one step closer to a coding agent that improves its own dispatch. v0.3 doesn't claim self-evolution. It ships the substrate: a persistent, ranked, operator-readable model of which futures matter, surfaced through a public Compose API so any future class — including the agent's own self-tooling — can plug in. The pi-blitz integration is the canonical demonstration.

## Install

```bash
pi install npm:pi-precognition
```

Recommended environment (safest defaults):

```bash
PI_PRECOG=1
PI_PRECOG_TOOL_CACHE=1
PI_PRECOG_COMMAND_FUTURES=1
PI_PRECOG_INJECTION_MODE=silent-futures
```

Hard off switch:
```bash
PI_PRECOG=0
```

## What it does

1. **Observes draft input** via Pi's terminal-input hooks (debounced, in-memory, ~50 ms analysis only).
2. **Extracts evidence**: path mentions, changed-file correlations, intent tags.
3. **Background-warms** safe repo-local file reads, filtered `git status`/`git diff`, bounded literal `rg` probes, and an allowlisted set of `bash` command futures (`npm test`, `npm run typecheck`, `npm run lint`, `vitest`, `jest`, `pytest`, `git status`, `git log`, `cat package.json`, `ls`) — each with a class-specific causal fingerprint.
4. **At `before_agent_start`** in `silent-futures` mode: nothing visible. The model sees the normal tool surface.
5. **When the model asks for a tool**: re-validate the causal fingerprint. If it still matches, serve the warmed result through the wrapped Pi-compatible tool (same model-facing schema as Pi's built-in). Otherwise miss safely and fall through to the wrapper's safe fallback implementation (repo-containment + secret denylist enforced).

The primitive is one sentence:

> Predict the wait, not the answer.

## Architecture

```mermaid
flowchart LR
    A["operator typing"] --> B["draft observer"]
    B --> C["read-only file futures"]
    B --> D["allowlisted command futures"]
    B --> E["evidence + intent tags"]
    C --> F[("warmed cache")]
    D --> F
    F --> G["wrapped read/bash/grep tools"]
    H["model"] -.->|"calls tool"| G
    G --> I{"causal fingerprint validates?"}
    I -->|"yes"| J["return warmed result (≈0 wait)"]
    I -->|"no"| K["fall through to wrapper's safe fallback"]
    J --> H
    K --> H
```

Five things compose:
1. **Draft observer** — debounced terminal-input hook (~50 ms in-memory analysis)
2. **Read-only futures** — repo-local file warms, secret-denylisted
3. **Command futures** — 13 allowlisted bash classes (`npm test`, `tsc --noEmit`, `git status`, ...), each with a class-specific causal fingerprint
4. **Wrapped tools** — `read`/`bash`/`grep` execute path with identical model-facing contract; cache lookup → causal validation → serve-or-fallthrough
5. **Hard off switch** — `PI_PRECOG=0` makes the entire extension a no-op

## What it does not do

- Does not predict what the model will say. The model still emits every tool call and every response.
- Does not execute mutating actions speculatively. Reads, status probes, and an allowlisted set of read-only commands only.
- Does not mutate workspace state. Ever.
- Does not serve a stale future. Every cache hit re-validates against current workspace state (file mtime/size for reads; per-class causal fingerprint for fingerprinted commands; TTL for fast probes like `git status`).
- Does not read `.env`, secrets, SSH config, AWS credentials, Docker auth, or any path matching the secret denylist (see [`docs/safety-model.md`](docs/safety-model.md)).
- Does not escape the working repo (realpath containment after symlink resolution).

## Safety

See [`docs/safety-model.md`](docs/safety-model.md). The invariants are:

- **I1.** Explicit request only — futures are served only when the model calls the matching tool.
- **I2.** No answer prediction — we cache tool *results*, not model output.
- **I3.** No mutation speculation — read-only futures and allowlisted read-only command futures only.
- **I4.** Causal-fingerprint validation at serve time — stale futures never serve.
- **I5.** Repo-local only — realpath containment after symlink resolution.
- **I6.** Secret-path denylist — `.env`, credentials, SSH/AWS/Docker config.
- **I7.** Skipped trees — `node_modules/`, `.git/`.
- **I8.** Bounded file size (24 KB default).
- **I9.** Binary refusal.
- **I10.** Hard off switch (`PI_PRECOG=0`).

The package is designed so that if you find a path that violates any invariant above, it is a release-blocking bug.

## Limits

- **Class-conditional.** Strong on deterministic agent turns (file reads, command runs, repo queries). Adds no measurable value on analytical or creative turns where the model is generating content from reasoning.
- **JS/TS + Python + npm + git surface today.** Other ecosystems (Cargo, Go, Maven, Bazel) work for file reads but the bash command class registry would need extension.
- **Single workspace per Pi process.** Cross-repo / multi-cwd scenarios not currently supported.
- **No live model-side compounding learning.** The current package is a deterministic primitive. Compounding pattern learning is a separate research direction.

## Reproducing the numbers

```bash
git clone https://github.com/ultronisnice/pi-precognition.git
cd pi-precognition
npm install
npm test                # 52 tests, all five injection modes, ~3s
npm run typecheck
npm run bench:local     # same as test — local microbenchmark + safety gates
npm run demo:visual     # ~18s scripted animation of the headline numbers (NOT a live run)
```

Live-API benchmark replay is being extracted into a `pi-precognition bench` CLI for the v0.3 release.

## Modes

| Mode | What the model sees | Recommended for |
|---|---|---|
| `silent-futures` (default) | Nothing hidden. Cache serves through normal tools. | **Production** |
| `verified-futures` | Tiny receipt that futures are armed. | Diagnostic |
| `cache-index` | Cache keys but not contents. | Economical context |
| `full` | Warmed file contents in a hidden custom message. | Bench/research |

Every headline number is measured against `silent-futures`. The broader 15-paired mixed A/B in [`docs/benchmarks.md`](docs/benchmarks.md) was run with `full` injection mode and is labeled there as historical/diagnostic context.

## Build a future

The package is the proof. The community is the unlock.

A **future class** declares a cache key, the command shapes the model might emit, a causal-file fingerprint, and an argv to run at warm time. Adding one for a new ecosystem (Cargo, Go, Maven, Bazel, ...) is ~30 lines and a fingerprint test.

- **[docs/build-a-future.md](docs/build-a-future.md)** — anatomy of a future class, the 30-line template
- **[examples/custom-future-class/](examples/custom-future-class/)** — worked example: `bash:cargo test`
- **[challenges/leaderboard.md](challenges/leaderboard.md)** — open class slots and the receipts board
- **[challenges/](challenges/)** — three open challenges:
  1. Add a command class (Cargo / Go / Maven / Gradle / Bazel)
  2. Find a safety bypass
  3. Reproduce the 522× baseline

> Build a future. Submit a receipt.

## Status

`pi-precognition` is research-backed and tests green under five injection-mode environments. The numbers above are reproducible. The next milestones:

- n=30+ paired live runs per workload with bootstrap CI
- Cross-provider replication (OpenAI Codex, Kimi)
- `pi-precognition bench` CLI bundled with the package

Issues and PRs welcome.

## Why this is not speculative tool execution

PASTE and Speculative Actions (2025) speculatively *execute* likely tool calls. If the prediction is wrong, the side effect already happened — and for mutating tools that's a real risk.

`pi-precognition` only ever **serves** cached results *after* the model explicitly requests the matching tool. Warming happens during operator typing; serving happens only on explicit request, gated by causal-fingerprint validation. A wrong warm guess is wasted I/O during draft time — never a wrong action. The model retains full agency. The wait disappears.

## License

MIT.
