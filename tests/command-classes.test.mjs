/**
 * Phase 1 — universal bash cache.
 *
 * Tests the COMMAND_CLASSES registry: every model-emitted command shape
 * routes to the right cache key, and unknown commands miss safely.
 */

import assert from "node:assert/strict";
import { test, before, after } from "node:test";

const MOD = "../src/precognition.ts";

const SAVED_ENV_KEYS = [
	"PI_PRECOG",
	"PI_PRECOG_INJECTION_MODE",
	"PI_PRECOG_TOOL_CACHE",
	"PI_PRECOG_COMMAND_FUTURES",
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

// Each row: [bash command the model emitted, expected cache key]
// Covers every COMMAND_CLASSES entry plus the legacy hidden-context keys.
const COMMAND_MATCHERS = [
	// Test class
	["npm test", "bash:npm test"],
	["npm test -- --silent", "bash:npm test"],
	["npm run test", "bash:npm test"],
	["npm test 2>&1 | tail -50", "bash:npm test"],
	["npx vitest", "bash:vitest"],
	["npx vitest run", "bash:vitest"],
	["vitest run", "bash:vitest"],
	["npm run test:vitest", "bash:vitest"],
	["npx jest", "bash:jest"],
	["jest", "bash:jest"],
	["npm run test:jest", "bash:jest"],
	["pytest", "bash:pytest"],
	["pytest -q", "bash:pytest"],
	["python -m pytest", "bash:pytest"],
	// Build class
	["npm run typecheck", "bash:npm typecheck"],
	["npm typecheck", "bash:npm typecheck"],
	["tsc --noEmit", "bash:npm typecheck"],
	["tsc -p tsconfig.probe.json --noEmit", "bash:npm typecheck"],
	["npx tsc --noEmit", "bash:npm typecheck"],
	["npm run lint", "bash:npm lint"],
	["npm lint", "bash:npm lint"],
	["npx eslint .", "bash:npm lint"],
	["npx eslint src", "bash:npm lint"],
	["npm run build", "bash:npm build"],
	["npm build", "bash:npm build"],
	["npx tsc -b", "bash:npm build"],
	// Review/debug class — read-only git probes
	["git status", "bash:git status"],
	["git diff", "bash:git diff"],
	["git diff --stat", "bash:git diff"],
	["git log", "bash:git log"],
	["git log --oneline -n 10", "bash:git log"],
	["git log -20", "bash:git log"],
	["cat package.json", "bash:cat package.json"],
	["ls", "bash:ls"],
	["ls -la", "bash:ls"],
	["ls src", "bash:ls"],
	["ls -la src", "bash:ls"],
];

// Phase 1 release gate: every command in the table routes to its expected key.
test("findCommandClass routes every Phase 1 command shape", async () => {
	const { findCommandClass } = await import(MOD);
	for (const [command, expectedKey] of COMMAND_MATCHERS) {
		const cls = findCommandClass(command);
		assert.ok(cls, `expected findCommandClass(${JSON.stringify(command)}) to return a class, got undefined`);
		assert.equal(
			cls.key,
			expectedKey,
			`route mismatch for ${JSON.stringify(command)}: got ${cls.key} want ${expectedKey}`,
		);
	}
});

// Phase 1 release gate: unknown bash commands do NOT match any class.
test("findCommandClass refuses commands outside the registry", async () => {
	const { findCommandClass } = await import(MOD);
	for (const command of [
		"rm -rf /",
		"curl https://example.com",
		"echo hello",
		"git push",
		"git commit -m wip",
		"ls /etc",
		"sudo rm",
		"docker run alpine",
	]) {
		const cls = findCommandClass(command);
		assert.equal(cls, undefined, `expected MISS for ${JSON.stringify(command)} but matched ${cls?.key}`);
	}
});

// Phase 1 release gate: registry has ≥12 distinct classes.
test("COMMAND_CLASSES registry exposes ≥12 distinct command classes", async () => {
	const { listCommandClasses } = await import(MOD);
	const classes = listCommandClasses();
	assert.ok(
		classes.length >= 12,
		`expected ≥12 command classes, got ${classes.length}: ${classes.map((c) => c.key).join(", ")}`,
	);
	// Every class has at least one intent tag.
	for (const c of classes) {
		assert.ok(c.intentTags.length > 0, `class ${c.key} has no intent tags`);
	}
	// Keys are unique.
	const keys = new Set(classes.map((c) => c.key));
	assert.equal(keys.size, classes.length, "duplicate command class keys");
});

// Phase 1 release gate: tryGhostToolCache returns a hit for a properly-seeded
// unfingerprinted class (validates the cache wiring end-to-end).
test("tryGhostToolCache serves unfingerprinted command futures end-to-end", async () => {
	const { tryGhostToolCache, createPrecogState } = await import(MOD);
	const state = createPrecogState();
	state.snapshot.cwd = process.cwd();
	state.ghostTools = [
		{
			name: "bash_command",
			key: "bash:git status",
			args: ["git status"],
			content: "warmed git status output",
			bytes: 24,
			collectedAt: Date.now(),
			causalFiles: undefined,
		},
	];
	const hit = tryGhostToolCache(state, "bash", { command: "git status" });
	assert.ok(hit, "expected cache HIT for git status with fresh seed");
	assert.equal(hit.details.precogKey, "bash:git status");
});

// Phase 1 release gate: legacy git_status_short / git_diff_name_only keys
// stay routable for the hidden-context warmGhostTools output paths.
test("legacy git_status_short and git_diff_name_only keys remain reachable", async () => {
	const { tryGhostToolCache, createPrecogState } = await import(MOD);
	const state = createPrecogState();
	state.snapshot.cwd = process.cwd();

	for (const [command, expectedKey] of [
		["git status --short", "git_status_short:status --short"],
		["git status -s", "git_status_short:status --short"],
		["git diff --name-only", "git_diff_name_only:diff --name-only"],
	]) {
		state.ghostTools = [
			{
				name: "bash_command",
				key: expectedKey,
				args: [command],
				content: "warmed legacy output",
				bytes: 20,
				collectedAt: Date.now(),
				causalFiles: undefined,
			},
		];
		const hit = tryGhostToolCache(state, "bash", { command });
		assert.ok(hit, `expected legacy HIT for ${JSON.stringify(command)}`);
		assert.equal(hit.details.precogKey, expectedKey);
	}
});
