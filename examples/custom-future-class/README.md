# Custom Future Class Example

v0.3 exposes a tiny Future Compose API for downstream packages.

```ts
import { registerFutureClass } from "pi-precognition/src/future-compose.ts";

registerFutureClass({
  key: "docs:markdown-preview",
  label: "Markdown preview future",
  kind: "command",
  intentTags: ["docs"],
  match: (evidence) => evidence.refs.some((path) => path.endsWith(".md")),
  describe: (evidence) => `preview docs touched by ${evidence.refs.join(", ")}`,
});
```

Future classes describe safe anticipation candidates. They do not bypass Pi tools or mutate files.
