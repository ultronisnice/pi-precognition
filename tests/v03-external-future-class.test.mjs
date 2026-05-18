import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("v0.3 external-style future class loads and registers", async () => {
	const compose = await import("../src/future-compose.ts");
	const core = await import("../src/core.ts");
	const cwd = await mkdtemp(join(tmpdir(), "precog-rust-"));
	await writeFile(join(cwd, "Cargo.toml"), "[package]\nname = \"fx\"\nversion = \"0.1.0\"\n");
	const example = await import("../examples/rust-cargo-check/index.ts");
	example.registerRustCargoCheckFuture(cwd);
	const keys = compose.listFutureClasses().map((f) => f.key);
	assert.ok(keys.includes("rust:cargo-check"), "rust:cargo-check must be registered after load");
	const evidence = core.analyzeDraft("fix src/main.rs and run cargo check", { knownFiles: ["src/main.rs"], changedFiles: ["src/main.rs"], source: "git" });
	const composed = compose.composeFutures(evidence);
	assert.ok(composed.some((f) => f.key === "rust:cargo-check"), "rust:cargo-check must compose for .rs evidence in a Cargo project");
});
