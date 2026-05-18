---
name: Safety bug
about: Report a path that violates one of the 10 safety invariants
title: "Safety bug: I<N> violation in <component>"
labels: safety, priority-high
---

> ⚠️ If the bypass is severe (any I1-I3 violation: served without explicit request, predicted an answer, or speculated a mutation), use a private GitHub security advisory instead:
> https://github.com/ultronisnice/pi-precognition/security/advisories/new

## Invariant violated

(Pick one — see `docs/safety-model.md`)

- [ ] I1. Explicit request only
- [ ] I2. No answer prediction
- [ ] I3. No mutation speculation
- [ ] I4. Causal-fingerprint validation at serve time
- [ ] I5. Repo-local only
- [ ] I6. Secret-path denylist
- [ ] I7. Skipped trees (`node_modules/`, `.git/`)
- [ ] I8. Bounded file size
- [ ] I9. Binary refusal
- [ ] I10. Hard off switch

## Reproduction

```bash
# Env, fixture files, command sequence
```

## Expected behavior

(What the invariant promises)

## Actual behavior

(What you observed)

## Proposed fix (optional)
