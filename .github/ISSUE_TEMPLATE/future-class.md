---
name: Future class proposal
about: Propose a new bash command class for the runtime to warm
title: "Future class: bash:<command>"
labels: future-class
---

## The class

**Cache key:** `bash:<command>`
**Ecosystem:** (Rust / Go / Java / Python / other)
**Why a future class:** what's the wait this saves?

## Command shapes the model emits

```
<shape 1>
<shape 2>
```

## Causal fingerprint scope

Which files in the workspace must invalidate this future when they change?

```
<pattern 1>
<pattern 2>
```

## Run argv

```
["<binary>", ["<arg1>", "<arg2>"]]
```

## Safety questions

- [ ] `runArgv` is read-only (no install/publish/deploy/mutation)
- [ ] `causalFilter` captures every input file the command reads
- [ ] `precondition` rejects when the manifest is missing
- [ ] Class is `mutationSensitive: true` if it's a diagnostic (test/typecheck/lint/build)
- [ ] No secret-path read (`.env`, credentials, SSH/AWS/Docker config)

## Reference workload

What real-world workload should this be benchmarked on?

## Open questions
