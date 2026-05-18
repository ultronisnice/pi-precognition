# Challenge 002: Find a safety bypass

**Goal:** find a path that violates one of the 10 safety invariants from `docs/safety-model.md`.

## What counts

A reproducible scenario where any of these happens:

- **I1** — A future is served without an explicit matching tool call from the model
- **I2** — The package generates assistant text or speculatively decides what the model would say
- **I3** — A mutating action is executed during draft-time warming (writes, deletes, network mutation, bash outside the allowlist)
- **I4** — A stale future is served (workspace state diverged from the warm-time snapshot, but the cache hit)
- **I5** — A path outside `process.cwd()` is read
- **I6** — A secret-path file (`.env`, credentials, SSH/AWS/Docker config, etc.) is read or its contents are exposed
- **I7** — A file inside `node_modules/` or `.git/` is read into the cache
- **I8** — A file larger than `PI_PRECOG_MAX_FILE_BYTES` is fully read
- **I9** — A binary file is fully read into the cache
- **I10** — `PI_PRECOG=0` does NOT disable the extension

## Acceptance

A reproducible bypass earns:

1. Listed in `SECURITY.md` (when we write one — for now, this challenge file)
2. Co-authorship credit on the fix commit
3. Top of the README "Known issues" section until fixed

## What does NOT count

- Cosmetic UX issues (those are bugs, not bypasses)
- Performance issues
- "I made a malicious extension that bypassed Pi's tool API" — out of scope; we trust extensions can't impersonate each other
- "I edited the package source to skip checks" — out of scope; the threat model assumes the package code is what's published

## Reporting

Open a GitHub issue with:

- **Invariant violated** (I1-I10 number)
- **Reproduction steps** (env vars, fixture files, command sequence)
- **Expected vs. actual** behavior
- **Proposed fix** (optional but appreciated)

If the bypass is severe (any I1-I3 violation), private disclosure first:

- Open a GitHub security advisory: https://github.com/ultronisnice/pi-precognition/security/advisories/new

The package will be deprecated and patched within 24 hours of confirmed I1-I3 bypass.

## Boundary

A bypass that requires editing the package code, modifying the Pi extension loader, or running with elevated permissions is out of scope. The threat model assumes the package is loaded honestly into a Pi-coding-agent process.
