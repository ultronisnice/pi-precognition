/**
 * Phase 2 — chain-depth-2 read futures.
 *
 * Verifies that when warmReadOnlyEvidence warms a depth-1 file containing
 * local imports, it also warms those imports as depth-2 futures.
 */

import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const MOD = "../src/precognition.ts";

const SAVED_ENV_KEYS = [
	"PI_PRECOG",
	"PI_PRECOG_INJECTION_MODE",
	"PI_PRECOG_TOOL_CACHE",
	"PI_PRECOG_COMMAND_FUTURES",
	"PI_PRECOG_CHAIN_DEPTH_2_BUDGET",
];
const SAVED = {};
before(() => {
	for (const k of SAVED_ENV_KEYS) {
		SAVED[k] = process.env[k];
		delete process.env[k];
	}
});
after(() => {
	for (const k of SAVED_ENV_KEYS) {
		if (SAVED[k] === undefined) delete process.env[k];
		else process.env[k] = SAVED[k];
	}
});

function seedChainFixture() {
	const dir = mkdtempSync(join(tmpdir(), "precog-chain-"));
	mkdirSync(join(dir, "src"), { recursive: true });

	// api.ts imports db.ts and auth.ts
	writeFileSync(
		join(dir, "src/api.ts"),
		[
			"import { findUser } from './db.ts';",
			"import { signToken } from './auth.ts';",
			"export async function login(id: string) {",
			"  const u = await findUser(id);",
			"  return signToken(u.id);",
			"}",
		].join("\n"),
	);
	writeFileSync(
		join(dir, "src/db.ts"),
		[
			"export async function findUser(id: string) {",
			"  return { id };",
			"}",
		].join("\n"),
	);
	writeFileSync(
		join(dir, "src/auth.ts"),
		[
			"export function signToken(id: string) {",
			"  return `sig-${id}`;",
			"}",
		].join("\n"),
	);
	writeFileSync(join(dir, "package.json"), '{"name": "fixture", "version": "0.0.0"}');
	// Init a git repo so gitKnownFiles returns these
	try {
		execFileSync("git", ["init", "-q"], { cwd: dir });
		execFileSync("git", ["add", "-A"], { cwd: dir });
		execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], { cwd: dir });
	} catch {
		// fall through; warmReadOnlyEvidence can resolve via discoverRepoFiles too
	}
	return dir;
}

test("Phase 2: warmReadOnlyEvidence walks depth-1 imports and emits depth-2 futures", async () => {
	const { warmReadOnlyEvidence, createPrecogState, analyzeDraft, refreshGitSnapshot } = await import(MOD);
	const cwd = seedChainFixture();
	const state = createPrecogState();
	state.snapshot.cwd = cwd;
	await refreshGitSnapshot(state, cwd);

	const evidence = analyzeDraft("fix src/api.ts for the login flow", state.snapshot);
	assert.ok(evidence, "fixture should produce evidence");
	assert.ok(evidence.refs.includes("src/api.ts"), "evidence should reference src/api.ts");

	await warmReadOnlyEvidence(state, cwd, evidence);

	// Depth-1 warm: src/api.ts
	const depth1Reads = state.warmedFiles?.filter?.((f) => f.path === "src/api.ts") ?? [];
	assert.ok(depth1Reads.length >= 1, `expected depth-1 warm of src/api.ts, got: ${JSON.stringify(state.warmedFiles?.map((f) => f.path))}`);

	// Trigger chain hop by also calling warmGhostTools (the depth-2 path is in there)
	const { warmGhostTools } = await import(MOD);
	await warmGhostTools(state, cwd, evidence);

	// Depth-2 warms appear in state.ghostTools (chainDepth === 2)
	const ghostReads = state.ghostTools.filter((t) => t.name === "read");
	const depth1Ghosts = ghostReads.filter((t) => t.chainDepth === 1).map((t) => t.path);
	const depth2Ghosts = ghostReads.filter((t) => t.chainDepth === 2).map((t) => t.path);
	assert.ok(depth1Ghosts.includes("src/api.ts"), `expected depth-1 ghost read of src/api.ts, got ${JSON.stringify(depth1Ghosts)}`);
	assert.ok(
		depth2Ghosts.includes("src/db.ts") || depth2Ghosts.includes("src/auth.ts"),
		`expected depth-2 ghost read of src/db.ts or src/auth.ts, got ${JSON.stringify(depth2Ghosts)}`,
	);
});

test("Phase 2: chain-depth-2 budget caps how many depth-2 futures we emit", async () => {
	process.env.PI_PRECOG_CHAIN_DEPTH_2_BUDGET = "1";
	try {
		const { warmGhostTools, createPrecogState, analyzeDraft, refreshGitSnapshot } = await import(MOD);
		const cwd = seedChainFixture();
		const state = createPrecogState();
		state.snapshot.cwd = cwd;
		await refreshGitSnapshot(state, cwd);
		const evidence = analyzeDraft("fix src/api.ts", state.snapshot);
		await warmGhostTools(state, cwd, evidence);
		const depth2 = state.ghostTools.filter((t) => t.name === "read" && t.chainDepth === 2);
		assert.ok(depth2.length <= 1, `expected at most 1 depth-2 ghost, got ${depth2.length}`);
	} finally {
		delete process.env.PI_PRECOG_CHAIN_DEPTH_2_BUDGET;
	}
});
