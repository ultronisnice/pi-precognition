# Security Policy

pi-precognition predicts waits, not answers.

## v0.3 Safety Contract

- No answer prediction.
- No speculative mutation.
- Repo-local only, with realpath containment after symlink resolution.
- Secret-looking paths are refused (`.env`, keys, cloud credentials, auth files, SSH material).
- Command futures are allowlisted and opt-in via `PI_PRECOG_COMMAND_FUTURES=1`.
- Fingerprinted command futures validate causal files at serve time.
- Unfingerprinted probes use short TTL validation only.
- Cache-invariant micro-delay preserves the model's tool-selection policy.
- Pattern Library stores only file paths, future keys, counts, timings, and rejection reasons — not file contents.
- Future Compose classes describe candidates; they do not execute mutating tools.

## Reporting

Open a GitHub security issue or contact the maintainer. Include:

1. exact command/draft,
2. relevant `PI_PRECOG_*` environment,
3. smallest reproduction repo possible.

Do not include real secrets in reports.
