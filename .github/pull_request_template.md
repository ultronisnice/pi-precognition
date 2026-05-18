## Type

- [ ] Bug fix
- [ ] New future class (see `docs/build-a-future.md`)
- [ ] Safety patch
- [ ] Documentation
- [ ] Benchmark receipt

## What this changes

(One sentence.)

## Receipts

- [ ] Tests pass: `npm test`
- [ ] Typecheck clean: `npm run typecheck`
- [ ] No behavior drift in default `silent-futures` mode
- [ ] No new secret-path or escape-from-cwd surface introduced

If this PR adds a **future class**, the safety + benchmark checklist:

- [ ] Pattern match test (multiple shapes)
- [ ] Negation test (mutating sibling commands rejected)
- [ ] Fingerprint test (modifying a tracked source file invalidates the future)
- [ ] Secret-path refusal test
- [ ] Precondition test (no manifest → no warming)
- [ ] Entry in `docs/future-classes.md`
- [ ] Row in `challenges/leaderboard.md` with measured wait saved
- [ ] Reproducible artifact in `validation/`

## What this is NOT

(Anything reviewers might suspect this is doing that it isn't.)
