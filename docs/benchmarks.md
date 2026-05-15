# Benchmarks

Reproducible numbers for `pi-precognition`. Every claim below is backed by a stored artifact in `validation/` and a runnable script. We report what we measured, how we measured it, and explicitly what the numbers do **not** mean.

## TL;DR

On the deterministic class of agent turns — where the model's first tool call is highly predictable from the draft — `pi-precognition` collapses first-tool blocked wait by **100-500×** and reduces end-to-end task completion by **2-3×**. On analytical or creative turns where the model is generating content from reasoning, it adds no measurable overhead and produces no measurable speedup.

The claim is **class-conditional**, not universal.

## Headline result: 15-second slow command

The strongest signal: a workload where `npm test` takes 15 seconds and the draft window is long enough (17s) for the future to complete pre-submit.

| Metric | Baseline (no precog) | With precog | Speedup |
| --- | ---: | ---: | ---: |
| **Cumulative blocked tool wait** | 15,234.70 ms | 29.16 ms | **522.5×** |
| **First tool result** | 18.37 s | 3.16 s | **5.82×** |
| **Task completion** | 21.91 s | 6.59 s | **3.32×** |
| Cache hits / misses | n/a | 3 / 0 | — |
| Hidden injections | n/a | 0 | — |
| Quality oracle pass | n/a | 100% | — |

**n=3 paired live runs.** Artifact: `validation/precog_live_ab_2026-05-15T05-57-56-215Z.md`.

### What this number IS
- Real wall-clock measurement of paired runs against `anthropic/claude-opus-4-7` through `pim`.
- The cache hit is served through the normal Pi `bash` tool. No model modification, no hidden context.
- Reproducible with the exact command in the artifact header.

### What this number is NOT
- It is not "general-purpose 522× faster agents." It is the upper bound on a single workload shape (long-command + sufficient draft budget).
- It is n=3. Strong directionally; not yet 20-run-with-CI shipped.

## Broader: 15-paired live A/B across 5 workloads

Across a mixed workload set (bugfix, failing-test, review, refactor, low-signal chat):

- **Completion win rate:** 93.3% for precognition-on
- **Avg completion:** 14.47 s → 10.35 s
- **Tool calls per turn:** 39 → 21
- **Post-check pass rate:** 100% on, 100% off
- **Timeouts:** 0 on, 0 off

Artifact: `validation/precog_live_ab_2026-05-15T03-08-38-018Z.md`. **n=15 paired runs**, randomized arm order.

## Workload class breakdown

| Workload | n | Completion (on/off) | First useful file (on/off) |
|---|---:|---:|---:|
| bugfix_explicit_file | 3 | 7.85s / 10.72s | 2.71s / 2.87s |
| failing_test_implicit_source | 3 | 11.05s / 21.86s | 3.37s / 2.68s |
| review | 3 | 12.70s / 14.45s | 2.63s / 2.89s |
| refactor | 3 | 19.29s / 19.38s | 3.20s / 2.95s |
| low_signal_chat | 3 | 2.82s / 3.45s | n/a |

Note `refactor` shows essentially no gain — that's the analytical class boundary in action.

## Microbenchmark (8 cases, 15 runs each)

Local microbenchmark of the warm/serve path, no API calls. Tests safety gates as well as speedup.

| Case | p50 warmed submit | p50 cold tools | p50 speedup | Leak check |
|---|---:|---:|---:|---|
| explicit_file_fix | 0.000773 ms | 24.878 ms | 32163.6× | pass |
| test_first | 0.000848 ms | 21.744 ms | 25643.3× | pass |
| stem_only_changed_file | 0.000714 ms | 146.866 ms | 205799.9× | pass |
| secret_adversarial | 0.000643 ms | 22.191 ms | 34493.6× | pass |
| low_signal | 0.000061 ms | 0.007 ms | n/a | pass |
| symlink_escape_adversarial | 0.001286 ms | 73.863 ms | n/a (correctly refused) | pass |
| binary_adversarial | 0.001338 ms | 76.248 ms | n/a (correctly refused) | pass |
| huge_file_adversarial | 0.001244 ms | 81.190 ms | n/a (correctly refused) | pass |

`n/a` rows are safety gates working correctly: the package refuses to warm and the speedup is irrelevant.

## How to reproduce

### Unit + safety tests
```bash
npm install
npm test           # runs all 52 unit + integration tests
npm run typecheck  # tsc strict mode
```

Tests verified green under five injection mode environments:
- clean (no env)
- `PI_PRECOG_INJECTION_MODE=silent-futures` (production default)
- `PI_PRECOG_INJECTION_MODE=cache-index`
- `PI_PRECOG_INJECTION_MODE=verified-futures`
- `PI_PRECOG_INJECTION_MODE=full`

### Headline replay
```bash
bash docs/demo.sh
```

This replays the slow-command numbers in ~18 seconds without making API calls.

### Live A/B (requires Anthropic API key + pim)
The exact harness used to produce live numbers is `scripts/ultron-live-ab.mjs` in the upstream Pi agent toolkit. It is being extracted into this package as `pi-precognition bench` for v0.3.

## Methodology

- **Provider/model:** `anthropic/claude-opus-4-7`, thinking=minimal
- **Harness:** `pim --mode json --no-session --no-context-files --no-prompt-templates --no-skills --no-extensions --extension <precog>`
- **Workloads:** seeded throwaway repos in `mkdtemp(...)` directories, git-init + initial commit
- **Pairing:** ON and OFF arms run against the same seeded fixture per run; arm order randomized via seeded RNG
- **Metrics captured:** submit→first-token, submit→first-tool-call, submit→first-tool-result, submit→first-useful-file-reference, cumulative blocked tool wait, task completion, tool count, exit code, post-check pass/fail (for mutation workloads), Anthropic usage (cache reads/writes + cost)
- **Quality oracle (gating):** file-reference Jaccard ≥ 0.7 AND verb Jaccard ≥ 0.6 between ON and OFF assistant text
- **Hardware:** Mac mini, Apple silicon, local pim

## What we do NOT claim

- **"522× faster on every turn."** False. It's specifically the blocked-tool-wait collapse on workloads where the cached tool is the dominant latency cost. Analytical and creative turns see ~0 speedup.
- **"3.32× faster across all coding tasks."** False. The 3.32× was on the 15s slow-command workload. The 15-paired mixed average is closer to 1.4× completion improvement.
- **"Universal across all agent harnesses."** False. The package depends on Pi's transparent `registerTool` API. Other harnesses don't currently expose the same surface.
- **"All-time SOTA in agent latency."** Not yet. The headline number is SOTA-shaped for the wedge primitive (first-tool wait collapse) but the systems claim requires n≥20 paired runs, multiple providers, multiple model families, and replication — which is the v0.3 sprint.

## Related work

| System | Speedup | Mechanism | How we differ |
|---|---|---|---|
| PASTE (arXiv:2603.18897) | 48.5% task time, 1.8× throughput | Speculatively execute likely next tool while model reasons | We never execute speculative tool calls; we cache results the model explicitly requests |
| Speculative Actions (2025) | 20% latency, 55% next-action accuracy | Predict next action | Action-level prediction; we are result-level caching |
| SpecCache (2025) | 3.2× web-env overhead reduction | Cache web environment results | Web agents; we cover repo workflows |
| SPAgent (2025) | 1.65× end-to-end | Search-agent caching | Domain-specific |
| Google Prompt Cache (MLSys 2024) | 8× GPU / 60× CPU TTFT | Reusable prompt modules | Different layer (cache attention KVs); complementary to ours |

We share the speculative-execution category with PASTE, but operate one layer earlier: **at draft time, before the first model call**. PASTE speculates *while* the model is thinking; we speculate *while the operator is typing*. The two approaches compose.

## Adversarial review

The package shipped after self-adversarial review documented in the parent lab. Survived:
- Secret prompt tried to include `.env`; warmed excerpts excluded it.
- Path traversal candidate did not warm.
- Repo-local symlink to outside file did not warm.
- Binary-looking file did not warm.
- Oversized file did not warm.
- Stem-only changed-file cue warms the correct file.
- Headless submit awaits a bounded startup git snapshot.
- Extension can be completely disabled with `PI_PRECOG=0`.

Not yet proven:
- Cross-provider replication (Codex, Kimi, other Anthropic models).
- n=20+ paired runs per workload with bootstrap CI.
- Long-running session compounding (separate research track).

## Artifact index

Public artifacts (referenced above) are not yet bundled into this npm package; they live in the development lab and are linked from the GitHub repo for now. The `pi-precognition bench` CLI in v0.3 will produce these artifacts directly.

## Honest summary

`pi-precognition` is a small, safe, validated latency primitive. On the workloads it targets it produces large numbers. On the workloads it doesn't target it produces nothing measurable, either positive or negative. The claim is intentionally narrow because the proof is real.
