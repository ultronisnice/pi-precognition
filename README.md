# pi-precognition

<p align="center">
  <strong>A personal anticipation engine for long, deep coding work.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/pi-precognition"><img alt="npm" src="https://img.shields.io/npm/v/pi-precognition?color=cb3837&label=npm"></a>
  <a href="https://github.com/ultronisnice/pi-precognition/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
  <a href="https://github.com/ultronisnice/pi-precognition/releases/tag/v0.3.0"><img alt="release" src="https://img.shields.io/badge/release-v0.3.0-1a73e8"></a>
  <img alt="pi-package" src="https://img.shields.io/badge/pi--package-extension-7c3aed">
  <img alt="tests" src="https://img.shields.io/badge/tests-82%2F82-22c55e">
  <img alt="status" src="https://img.shields.io/badge/status-research--backed-1a73e8">
</p>

<p align="center">
  <img src="docs/demo.gif" alt="pi-precognition headline demo: a 15-second npm test served in 29ms through wrapped Pi-compatible tools" width="100%">
</p>

---

v0.3 ships the core substrate for **persistent, cross-session personal anticipation** — the foundation that lets an agent learn how *you* actually work and start reducing the repetitive friction in your workflow.

This is the first release where the system moves beyond local, session-scoped guessing into durable, learnable patterns that survive across restarts and projects.

→ **[Install](#install)** · **[Reproduce](challenges/003-reproduce-the-baseline.md)** · **[Build a future](docs/build-a-future.md)**

---

## The Leap (v0.2 → v0.3)

**v0.2** was speculative warming. It watched your draft and tried to pre-compute expensive results in the moment. It was useful, but fundamentally short-term and stateless.

**v0.3** introduces the real building blocks for something that compounds:

- A **Pattern Library** that persists across sessions and projects.
- A **Mutation Stream** that re-arms futures when your files change.
- An **Anticipation Planner** that turns observed behavior into bounded, actionable plans.
- A **Future Compose API** that makes it straightforward for anyone to add new future classes.
- First-class CLI surfaces (`doctor`, `patterns`, `watch`, `bench`) so you can see and interact with the system directly.

This is the shift from a clever local cache to the early form of a system that can build a model of its operator over time.

---

## Who This Is For Right Now

pi-precognition v0.3 is built for people who do **long, focused, or autonomous sessions** on the same codebase(s) over hours and days.

It gets better the longer you stay in the same project. The more repetition the system sees, the stronger the patterns become. If your work involves repeated reads of the same modules and frequent expensive commands (typecheck, test, build, etc.), you will feel the difference over time.

If you mostly do short sessions or constantly jump between unrelated tasks, the value will be lower until more surfaces are added.

---

## The Headline Number

On the slow-command workload (a `bash("npm test")` that takes 15 seconds, with 17s of draft budget), `pi-precognition` drops the blocked tool wait from **15.2 seconds to 29 milliseconds** — a **522× collapse** of the dominant latency cost.

| Metric | Baseline | With `pi-precognition` | Speedup |
|---|---:|---:|---:|
| Blocked tool wait | 15,234 ms | 29 ms | **522×** |
| First tool result | 18.4 s | 3.2 s | **5.8×** |
| Task completion | 21.9 s | 6.6 s | **3.3×** |
| Hidden injections | n/a | 0 | — |
| Quality parity | n/a | 100% | — |

**n=3 paired live runs. Boundary: deterministic-class agent turns only.** See [`docs/benchmarks.md`](docs/benchmarks.md) for the full methodology and the workload class breakdown.

v0.3 adds 30 paired-benchmark samples across 3 real projects. See [`validation/v0.3-evidence-report.md`](validation/v0.3-evidence-report.md).

---

## What Shipped in v0.3

- Persistent Pattern Library with cross-session and cross-project storage
- Mutation Stream that re-arms futures based on file changes
- Anticipation Planner that turns evidence into concrete warming plans
- Future Compose API for registering new future classes
- CLI tools: `doctor`, `patterns`, `watch`, and improved `bench`
- First-class community surface (`build-a-future`, challenges, templates)
- 82/82 tests passing + paired benchmark receipts across real projects
- Full documentation and examples (including Rust cargo support)

The full release evidence and receipts are in the repo.

---

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

---

## Build the Next Layer

v0.3 gives you the tools to extend the system yourself.

The Future Compose API is now first-class. If you work in a language or workflow that isn't covered yet (or want to optimize something specific to how *you* work), you can add your own future class.

We're deliberately opening this up early. The more high-quality future classes exist, the more useful the system becomes for everyone.

→ [Build a Future](docs/build-a-future.md)
→ [Current open slots & leaderboard](challenges/leaderboard.md)

If you ship something real with receipts during this window, it becomes part of the early record of how this thing grew.

---

## What's Next (v0.4 and beyond)

The bigger direction is turning observed behavior into active, gated steering.

In the next release we expect to bring in the Mirror — the persistent model that can not only predict what you'll need, but begin to act on it with proper receipts and safety gates. That work is already in progress on the internal track and will land as v0.4 once it has real cross-session evidence.

v0.3 is the substrate. v0.4 is when the model starts earning the right to steer.

---

## Safety

The v0.2 safety invariants are preserved as a strict superset:

- **Silent-futures default** — nothing is hidden in the model's context.
- **Causal-fingerprint validation at serve time** — stale futures never serve.
- **Repo-local only** — realpath containment after symlink resolution.
- **Secret-path denylist** — `.env`, credentials, SSH/AWS/Docker config.
- **Hard off switch** — `PI_PRECOG=0` makes the entire extension a no-op.

See [`docs/safety-model.md`](docs/safety-model.md) for the full invariant list. Any path that violates an invariant is a release-blocking bug.

---

## Status

- 82/82 tests passing
- Typecheck clean
- Clean history with full receipts
- v0.3.0 tag published

This is the foundation release. The real compounding power will grow as usage data and new future classes flow back into the system.

---

## License

MIT.

Contributions and new future classes are welcome.
