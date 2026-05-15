/**
 * Widget format tests — the visible face. The status line vocabulary is
 * part of the package's UX contract.
 */

import assert from "node:assert/strict";
import { test, before, after } from "node:test";

const MOD = "../src/precognition.ts";

const SAVED = {};
const KEYS = ["PI_PRECOG_INJECTION_MODE", "PI_PRECOG"];
before(() => {
	for (const k of KEYS) {
		SAVED[k] = process.env[k];
		delete process.env[k];
	}
});
after(() => {
	for (const k of KEYS) {
		if (SAVED[k] === undefined) delete process.env[k];
		else process.env[k] = SAVED[k];
	}
});

test("formatWidget: watching state when no evidence", async () => {
	const { formatWidget, createPrecogState } = await import(MOD);
	const state = createPrecogState();
	const line = formatWidget(undefined, state);
	assert.match(line, /^precog · watching · silent$/);
});

test("formatWidget: watching state when evidence confidence < 0.25", async () => {
	const { formatWidget, createPrecogState } = await import(MOD);
	const state = createPrecogState();
	const evidence = {
		summary: "x",
		observations: [],
		refs: [],
		changed: [],
		intentTags: [],
		draftHash: "h",
		confidence: 0.1,
		source: "git",
	};
	const line = formatWidget(evidence, state);
	assert.match(line, /watching/);
});

test("formatWidget: 'no deterministic futures' when evidence is good but nothing warmed", async () => {
	const { formatWidget, createPrecogState } = await import(MOD);
	const state = createPrecogState();
	const evidence = {
		summary: "x",
		observations: [],
		refs: ["src/api.ts"],
		changed: [],
		intentTags: ["test"],
		draftHash: "h",
		confidence: 0.9,
		source: "git",
	};
	const line = formatWidget(evidence, state);
	assert.match(line, /no deterministic futures/);
});

test("formatWidget: 'armed' state with future count + fingerprinted tag", async () => {
	const { formatWidget, createPrecogState } = await import(MOD);
	const state = createPrecogState();
	state.warmedFiles = [{ path: "src/api.ts", bytes: 100, excerpt: "x", collectedAt: Date.now() }];
	state.ghostTools = [
		{
			name: "bash_command",
			key: "bash:npm test",
			args: ["npm test"],
			content: "ok",
			bytes: 2,
			collectedAt: Date.now(),
			causalFiles: [{ path: "src/api.ts", mtimeMs: 0, size: 100, sha1: "x" }],
		},
	];
	const evidence = {
		summary: "x",
		observations: [],
		refs: ["src/api.ts"],
		changed: [],
		intentTags: ["test"],
		draftHash: "h",
		confidence: 0.9,
		source: "git",
	};
	const line = formatWidget(evidence, state);
	assert.match(line, /precog · 2 futures armed · silent · fingerprinted/);
});

test("formatWidget: singular 'future' when armed=1, no fingerprint when none fingerprinted", async () => {
	const { formatWidget, createPrecogState } = await import(MOD);
	const state = createPrecogState();
	state.warmedFiles = [{ path: "src/api.ts", bytes: 100, excerpt: "x", collectedAt: Date.now() }];
	const evidence = {
		summary: "x",
		observations: [],
		refs: ["src/api.ts"],
		changed: [],
		intentTags: [],
		draftHash: "h",
		confidence: 0.9,
		source: "git",
	};
	const line = formatWidget(evidence, state);
	assert.match(line, /1 future armed/);
	assert.doesNotMatch(line, /fingerprinted/);
});

test("formatHitReceipt: 'precog ✓ KEY · COLD → SERVED · fingerprint ok'", async () => {
	const { formatHitReceipt } = await import(MOD);
	const line = formatHitReceipt({
		tool: "bash",
		key: "bash:npm test",
		servedMs: 750,
		coldEstimateMs: 15234,
		fingerprintValidated: true,
	});
	assert.match(line, /^precog ✓ bash:npm test · 15\.2s → 750ms · fingerprint ok$/);
});

test("formatHitReceipt: 'ttl ok' when no fingerprint", async () => {
	const { formatHitReceipt } = await import(MOD);
	const line = formatHitReceipt({
		tool: "bash",
		key: "bash:git status",
		servedMs: 800,
		coldEstimateMs: 800,
		fingerprintValidated: false,
	});
	assert.match(line, /ttl ok/);
});

test("formatHitReceipt: durations format sensibly (sub-ms / ms / s)", async () => {
	const { formatHitReceipt } = await import(MOD);
	const subMs = formatHitReceipt({ tool: "read", key: "read:x", servedMs: 0.3, coldEstimateMs: 5, fingerprintValidated: true });
	assert.match(subMs, /5ms → 0\.30ms/);
	const ms = formatHitReceipt({ tool: "read", key: "read:x", servedMs: 5, coldEstimateMs: 50, fingerprintValidated: true });
	assert.match(ms, /50ms → 5ms/);
	const sec = formatHitReceipt({ tool: "bash", key: "bash:x", servedMs: 1200, coldEstimateMs: 15000, fingerprintValidated: true });
	assert.match(sec, /15\.0s → 1\.2s/);
});

test("formatStaleRejection: 'precog · stale future rejected · fallback safe'", async () => {
	const { formatStaleRejection } = await import(MOD);
	const line = formatStaleRejection({ tool: "bash", key: "bash:npm test" });
	assert.match(line, /^precog · stale future rejected · fallback safe$/);
});

test("formatSessionSummary: 'precog · armed N · hits M · MODE'", async () => {
	const { formatSessionSummary, createPrecogState } = await import(MOD);
	const state = createPrecogState();
	state.stats.ghostToolWarms = 3;
	state.stats.toolCacheHits = 2;
	const line = formatSessionSummary(state);
	assert.match(line, /precog · armed 3 · hits 2 · silent/);
});

test("formatSessionSummary: 'no activity' when nothing happened", async () => {
	const { formatSessionSummary, createPrecogState } = await import(MOD);
	const state = createPrecogState();
	const line = formatSessionSummary(state);
	assert.match(line, /no activity/);
});

test("formatWidget: respects PI_PRECOG_INJECTION_MODE for the mode tag", async () => {
	const { formatWidget, createPrecogState } = await import(MOD);
	const state = createPrecogState();
	process.env.PI_PRECOG_INJECTION_MODE = "full";
	try {
		const line = formatWidget(undefined, state);
		assert.match(line, /· full$/);
	} finally {
		delete process.env.PI_PRECOG_INJECTION_MODE;
	}
});
