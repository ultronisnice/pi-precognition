# Agents should compile waiting into futures

## Why this exists

Agents wait too much. The dominant cost of a coding-agent turn is rarely the model — it's the tool. `npm test` takes 15 seconds. `tsc --noEmit` takes 8. `cargo test` takes 30. The model thinks for 3 seconds and then sits blocked for ten times longer waiting on a deterministic command whose result was knowable the moment the operator finished typing.

Most agent latency work attacks this from inside the model loop. PASTE ([arXiv:2603.18897](https://arxiv.org/abs/2603.18897)) speculates likely next tool calls while the model is reasoning. SpecCache ([2025](https://arxiv.org/abs/2510.21847)) caches environment results for web agents. Both are real wins — both operate *during* the model's turn.

`pi-precognition` operates one layer earlier.

> PASTE speculates while the model is thinking.
> `pi-precognition` speculates while the operator is typing.

When you hit enter, the answer for a 15-second `npm test` is already sitting in cache, fingerprinted against your workspace state. The model asks, the wrapper re-validates the fingerprint, and the cached output flows back in milliseconds.

## The mechanism in five steps

1. **Observe** — Pi exposes a draft-time hook (`onTerminalInput`). The extension watches the operator type, debounced, in-memory.
2. **Extract** — path mentions, changed-file correlations, intent tags ("test", "build", "review"). All from the draft text alone. Pure regex; no model call.
3. **Warm** — for each detected intent, the extension runs an allowlisted read-only command (`npm test`, `tsc --noEmit`, `git status`, ...) in the background. The output is stored with a causal fingerprint: sha1+size+mtime over every file whose change would invalidate the result.
4. **Validate** — when the model emits the exact tool call, the wrapper re-collects the fingerprint. If identical to warm-time, serve the cached output. If diverged, fall through to the real tool.
5. **Receipt** — the operator sees a one-line status: `precog ✓ bash:npm test · 15.2s → 29ms · fingerprint ok`.

The wait is gone. The model's tool contract is unchanged. No hidden context was injected. No mutating action was speculated. The work just happened earlier.

## The safety contract

A latency primitive only earns trust if the safety surface is small and explicit. `pi-precognition` enforces ten invariants under all five injection modes:

```
I1   Explicit request only — futures serve only on matching model tool call
I2   No answer prediction — we cache tool RESULTS, never model text
I3   No mutation speculation — read-only futures + allowlisted read-only commands
I4   Causal-fingerprint validation at serve time — stale futures never serve
I5   Repo-local only (realpath containment + secret denylist)
I6   Secret-path denylist (.env, credentials, SSH/AWS/Docker config)
I7   Skipped trees (node_modules/, .git/)
I8   Bounded file size (24 KB default)
I9   Binary refusal
I10  Hard off switch (PI_PRECOG=0 disables everything)
```

These are testable. If you find a path that violates any of them, see [Challenge 002](../challenges/002-find-a-safety-bypass.md). Confirmed bypasses are release-blocking bugs.

## What this is not

- **Not 522× on every turn.** The headline number is the upper bound on a workload where the dominant latency is a long-running deterministic tool and the operator's typing time exceeds the tool's runtime. Analytical and creative turns see ~0 speedup because the model is generating from reasoning, not retrieving.
- **Not a general-purpose agent accelerator.** Class-conditional. The benchmarks doc breaks down what each workload class actually produces.
- **Not speculative tool execution in the PASTE sense.** PASTE runs likely next tool calls. We only cache results the model explicitly requests.
- **Not a memory primitive.** Memory remembers. This relocates time. The cache is a *time-shifter*, not a recall mechanism.

## Receipts

The full set of artifacts ships in the repo:

| Artifact | What it shows |
|---|---|
| [`validation/precog_live_ab_2026-05-15T05-57-56-215Z.md`](../validation/precog_live_ab_2026-05-15T05-57-56-215Z.md) | n=3 paired live on the slow-command workload: 522× blocked-tool-wait collapse, silent-futures, zero hidden injections |
| [`validation/precog_live_ab_2026-05-15T03-08-38-018Z.md`](../validation/precog_live_ab_2026-05-15T03-08-38-018Z.md) | n=15 paired mixed (historical, `full` injection mode): 93% completion win rate, 100% post-check pass |
| [`docs/benchmarks.md`](./benchmarks.md) | Methodology, related-work comparison, "what we do NOT claim" boundary list |
| [`docs/safety-model.md`](./safety-model.md) | 10 explicit invariants, threat model, command allowlist table |

## Build a future class

The package is the proof. The community is the unlock.

A **future class** declares: a cache key, command shapes the model emits, a causal-file fingerprint, and an argv to run at warm time. Adding one for a new ecosystem (Cargo, Go, Maven, Bazel, ...) is ~30 lines and a fingerprint test.

See [`docs/build-a-future.md`](./build-a-future.md) for the worked example.

Open class slots are tracked in [`challenges/leaderboard.md`](../challenges/leaderboard.md). The first PR to land a class becomes the maintainer of record for that class.

> Build a future. Submit a receipt.

## Runtime roadmap

`pi-precognition` is the first artifact in a longer chain:

```
pi-precognition  →  draft-time futures           (public, today)
pi-cascade       →  intra-turn future chains     (roadmap)
pi-lattice       →  bounded future graphs        (roadmap)
pi-pruner        →  expected-value governance    (roadmap)
pi-epochs        →  experience compiled into policy (roadmap)
ULTRXN Runtime   →  agents that wait less the longer they run  (thesis)
```

Only the first node is shipped and proven. The rest is roadmap. The runtime claim ("agents that compound") needs the compounding graph to be earned — see [`ULTRXN.md`](../ULTRXN.md) for the thesis and its bounded form.

## How to take this work seriously

- **Install it.** `pi install npm:pi-precognition`. 90 seconds.
- **Reproduce the number.** [Challenge 003](../challenges/003-reproduce-the-baseline.md). Run the slow-command workload through your own Pi. Verify the receipt fires.
- **Break the safety contract.** [Challenge 002](../challenges/002-find-a-safety-bypass.md). Ten invariants; find a path through.
- **Ship a future class.** [Challenge 001](../challenges/001-add-command-class.md). Cargo, Go, Maven, Gradle, Bazel are all open.

Predict the wait, not the answer.

— ULTRXN
