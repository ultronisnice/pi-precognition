# Safety Model

Precognition treats draft text as untrusted input.

It warms only repo-contained text evidence and allowlisted command futures. File futures are committed only if the file still has the same size and modified time. Command futures are committed only if their causal file fingerprint still matches.

The package refuses absolute path escapes, traversal, binary-looking files, oversized files, `.env`, credential files, SSH/config secrets, `.git`, and `node_modules`.

