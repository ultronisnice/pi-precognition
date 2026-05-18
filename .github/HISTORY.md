# History notes

## 2026-05-18 — pre-v0.3 commit-message scrub

Before the v0.3.0 release, all commits up to and including the public
`v0.2.0` tag had their commit *messages* rewritten to remove two
incidental identity strings (a personal handle and a superseded legacy
codename) that appeared inside leak-scan boast lines such as
*"LEAK SCAN: clean. No `<handle>` paths. No ULTRON/ULTRXN/`<legacy>`
references."* No source file content changed; the rewrite was scoped to
commit messages only via `git filter-branch --msg-filter`.

Consequences:

- Every commit SHA from the project's root through `v0.2.0` changed.
- The `v0.2.0` tag was retargeted at the new SHA.
- A `--force-with-lease` push was used to update the public history.
- The `pi-precognition@0.2.0` package on npm is unaffected (npm tarballs
  are content-addressed by tarball hash, not git SHA).
- Old SHAs may remain reachable via direct GitHub commit URLs for
  approximately 90 days until GitHub garbage-collects them.

If you cloned the repository before this date and want to align with
the new history, the cleanest path is a fresh clone or
`git fetch && git reset --hard origin/main`.

— ULTRON
