# Future Compose API

v0.3 lets downstream packages describe new future classes without weakening the safety model.

```ts
import { registerFutureClass } from "pi-precognition/src/future-compose.ts";

registerFutureClass({
  key: "docs:markdown-preview",
  label: "Markdown preview future",
  kind: "command",
  intentTags: ["docs"],
  match: (evidence) => evidence.refs.some((path) => path.endsWith(".md")),
  describe: (evidence) => `preview docs for ${evidence.refs.join(", ")}`,
});
```

Future classes are descriptive anticipation candidates. They do not bypass Pi tools, do not mutate files, and do not serve cached content unless a normal Pi tool request matches and validates.

Built-ins added in v0.3:

- `pi_blitz:edit` — symbolic edit/refactor likely over mentioned source files
- `pi_blitz:batch` — multi-file symbolic refactor candidate

See `examples/custom-future-class/` for a minimal external class.
