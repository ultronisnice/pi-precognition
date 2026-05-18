# Mutation Stream → Live Anticipation

v0.3 exposes a small mutation stream primitive:

```ts
import { createMutationStream, recordMutationSnapshot } from "pi-precognition/src/mutation-stream.ts";

const stream = createMutationStream(process.cwd());
const event = await recordMutationSnapshot(stream);
```

The stream watches `git status --short` and reports:

- `changed`
- `added`
- `removed`
- `modified`

The CLI uses it in:

```bash
pi-precognition watch
pi-precognition patterns --live
```

Mutation events do not execute mutating actions. They update anticipation state and make stale/causal drift visible.
