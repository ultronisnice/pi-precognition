# Build your own future class — `cargo check` example (15–30 min)

This example shows how a third-party package can add a future class to pi-precognition v0.3 without touching the core. We build a **Rust `cargo check` preflight** future: whenever the operator drafts an edit to a `.rs` file inside a Cargo project, the engine arms `cargo check` so the post-commit wait is gone.

It is non-trivial because:

1. It depends on **two pre-conditions** (a `Cargo.toml` must exist AND a `.rs` file must appear in the evidence) — not a single regex match.
2. The pre-condition check uses `process.cwd()` and `existsSync`, so it integrates with the host filesystem, not just the evidence object.
3. It is a *real* expensive future. `cargo check` on a non-trivial crate is multi-second.

## Step 1 — Read the contract (2 min)

`pi-precognition/src/future-compose.ts` exposes:

```ts
export interface FutureClassDefinition {
  key: string;          // unique id, e.g. "rust:cargo-check"
  label: string;        // human label for the live view
  kind: "read" | "command" | "tool";
  intentTags: string[]; // ["build"], ["debug"], etc. — used by Pattern Library labeling
  tools?: string[];     // optional declared tool surface
  match(evidence): boolean;        // when should this future arm?
  describe(evidence): string;      // human description of the warmed action
}

registerFutureClass(def): void;    // call once per future
listFutureClasses(): readonly FutureClassDefinition[];
composeFutures(evidence): Future[];
```

The contract is intentionally small. Three required fields, two methods.

## Step 2 — Sketch the match (3 min)

The `cargo check` future should arm whenever:

- a `Cargo.toml` lives in the project root, AND
- the operator's evidence references a `.rs` file (either via explicit ref or via `git status` changed list).

```ts
const RUST_EXT = /\.rs$/;
match: (evidence) =>
  hasCargoToml &&
  (evidence.refs.some((p) => RUST_EXT.test(p)) || evidence.changed.some((p) => RUST_EXT.test(p))),
```

## Step 3 — Register it (3 min)

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { registerFutureClass } from "pi-precognition/src/future-compose.ts";

export function registerRustCargoCheckFuture(projectCwd: string): void {
  const hasCargoToml = existsSync(join(projectCwd, "Cargo.toml"));
  registerFutureClass({
    key: "rust:cargo-check",
    label: "cargo check (Rust preflight)",
    kind: "command",
    intentTags: ["build", "debug"],
    tools: ["bash"],
    match: (evidence) => /* … */,
    describe: (evidence) => /* … */,
  });
}
```

Full code in `examples/rust-cargo-check/index.ts`.

## Step 4 — Wire it into an extension boot path (5 min)

In a host pi extension:

```ts
import { default as installPrecognition } from "pi-precognition";
import { registerRustCargoCheckFuture } from "pi-precognition/examples/rust-cargo-check";

export default function myExtension(pi) {
  registerRustCargoCheckFuture(process.cwd());
  installPrecognition(pi);
}
```

The order matters: register the future class BEFORE the engine starts composing futures for the first draft.

## Step 5 — Verify it shows up (2 min)

```bash
node -e "import('./examples/rust-cargo-check/index.ts').then(() => {
  import('./src/future-compose.ts').then((m) => {
    console.log(m.listFutureClasses().map((f) => f.key));
  });
});"
```

Expected output includes `"rust:cargo-check"` alongside the built-ins `"pi_blitz:edit"` and `"pi_blitz:batch"`.

## Step 6 — Watch it learn (5 min)

In a real Rust crate:

```bash
cd ~/my-rust-project   # must contain Cargo.toml
node /path/to/pi-precognition/src/cli.ts patterns --cwd .
# (nothing yet — Pattern Library is empty)

# … do some Rust editing, run cargo check a few times via the wrapped pi extension …

node /path/to/pi-precognition/src/cli.ts patterns --cwd .
# Pattern Library now shows:
#   - … · futures: rust:cargo-check a3/h2/r0, …
```

That's it. The class is now persisted in `.pi-precognition/patterns.json`, ranked alongside the built-ins, and surfaced in the operator-readable summary.

## What this proves

- The Compose API is **real**, not aspirational — it loads, registers, and is composed into the runtime evidence pipeline.
- The Pattern Library treats third-party future keys identically to `pi_blitz:*` and `bash:*` keys.
- The build-your-own path is **legitimately under 30 minutes** for someone who already knows pi extensions.

## What is NOT claimed

- This example does not actually invoke `cargo check` for you — that wiring happens at the host extension's ghost-tool layer. The future class only declares anticipation eligibility.
- The example assumes `Cargo.toml` in `process.cwd()`. A more advanced version would walk upward for the nearest workspace manifest.
