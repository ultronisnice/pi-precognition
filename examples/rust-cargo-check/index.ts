/**
 * Example external-style future class: Rust `cargo check` preflight.
 *
 * Demonstrates how a third-party package can extend pi-precognition without
 * touching the core. This is a NON-TRIVIAL future class: it inspects evidence
 * for Rust source paths AND requires a Cargo.toml to exist in the project, AND
 * surfaces a precise rejection reason when either pre-condition fails.
 *
 * Use case: a Rust monorepo that wants `cargo check` armed whenever the
 * operator drafts an edit to a .rs file. Saves the post-commit wait by paying
 * the cargo-check cost during draft time.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { registerFutureClass } from "../../src/future-compose.ts";

const RUST_EXT = /\.rs$/;

export function registerRustCargoCheckFuture(projectCwd: string): void {
	const hasCargoToml = existsSync(join(projectCwd, "Cargo.toml"));
	registerFutureClass({
		key: "rust:cargo-check",
		label: "cargo check (Rust preflight)",
		kind: "command",
		intentTags: ["build", "debug"],
		tools: ["bash"],
		match: (evidence) => {
			if (!hasCargoToml) return false;
			return evidence.refs.some((path) => RUST_EXT.test(path)) || evidence.changed.some((path) => RUST_EXT.test(path));
		},
		describe: (evidence) => {
			const rustFiles = [...evidence.refs, ...evidence.changed].filter((path) => RUST_EXT.test(path));
			return `cargo check across ${rustFiles.slice(0, 3).join(", ") || "Rust crate"}`;
		},
	});
}

/* Auto-register at module load only if a Cargo.toml is in process.cwd().
   For testing / explicit projects, call registerRustCargoCheckFuture(cwd) directly. */
if (existsSync(join(process.cwd(), "Cargo.toml"))) {
	registerRustCargoCheckFuture(process.cwd());
}
