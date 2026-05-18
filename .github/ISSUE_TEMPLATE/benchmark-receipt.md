---
name: Benchmark receipt
about: Submit a measured reproduction or new workload benchmark
title: "Benchmark: <workload> on <machine>"
labels: benchmark, receipt
---

## Workload

- **Class:** `bash:<command>` or `read:<pattern>`
- **Fixture:** (link to a repo or paste a minimal package.json + source)
- **Pi/pim version:** `pi --version`
- **Provider/model:** e.g. `anthropic/claude-opus-4-7`
- **Machine:** CPU + RAM + OS
- **Date:** YYYY-MM-DD

## Numbers

| Metric | Baseline (off) | With precognition | Speedup |
|---|---:|---:|---:|
| Blocked tool wait | _ms | _ms | _× |
| First tool result | _s | _s | _× |
| Task completion | _s | _s | _× |
| Hidden injections (default mode) | _ | 0 | — |

Paired runs: n=_
Injection mode: `silent-futures` (default) / `full` / other

## Artifact

(Paste the JSON/markdown from your `PI_PRECOG_LOG` or attach the file.)

## Replicates challenge?

- [ ] [Challenge 003: Reproduce the baseline](../../challenges/003-reproduce-the-baseline.md)

If yes, also open a PR adding your row to `challenges/leaderboard.md`.
