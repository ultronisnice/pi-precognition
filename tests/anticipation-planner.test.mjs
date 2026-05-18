import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planAnticipation, applyPlanToEvidence } from "../src/anticipation-planner.ts";
import { evaluateExpensiveFutures } from "../src/mutation-stream.ts";

async function makeCwd(t) {
	const dir = await mkdtemp(join(tmpdir(), "pi-precog-plan-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	return dir;
}

async function seedLibrary(cwd, library) {
	await mkdir(join(cwd, ".pi-precognition"), { recursive: true });
	await writeFile(join(cwd, ".pi-precognition", "patterns.json"), JSON.stringify(library, null, 2));
}

test("planAnticipation returns empty plan when no library exists", async (t) => {
	const cwd = await makeCwd(t);
	const evidence = {
		refs: ["src/foo.ts"],
		changed: [],
		intentTags: ["test"],
		confidence: 0.4,
		draftHash: "x",
	};
	const plan = await planAnticipation(cwd, evidence);
	assert.equal(plan.boostedRefs.length, 0);
	assert.equal(plan.armedKeys.length, 0);
	assert.equal(plan.suppressedKeys.length, 0);
});

test("planAnticipation boosts refs and arms futures when library has paid-off history", async (t) => {
	const cwd = await makeCwd(t);
	await seedLibrary(cwd, {
		version: 1,
		project: "demo",
		updatedAt: Date.now(),
		patterns: [
			{
				id: "p1",
				label: "test-after-edit",
				project: "demo",
				refs: ["src/foo.ts", "src/foo.test.ts", "src/helpers.ts"],
				intentTags: ["test"],
				count: 5,
				confidence: 0.6,
				futures: [
					{ key: "bash:npm test", armed: 5, hits: 3, misses: 1, rejections: 0, savedMs: 6000, lastSeenAt: Date.now() },
					{ key: "bash:npm run lint", armed: 2, hits: 0, misses: 1, rejections: 4, savedMs: 0, lastSeenAt: Date.now() },
				],
				createdAt: Date.now(),
				updatedAt: Date.now(),
			},
		],
		events: [],
	});
	const evidence = {
		refs: ["src/foo.ts"],
		changed: [],
		intentTags: ["test"],
		confidence: 0.4,
		draftHash: "x",
	};
	const plan = await planAnticipation(cwd, evidence);
	assert.ok(plan.matchedPatterns.length >= 1, "should match the seeded pattern");
	assert.ok(plan.boostedRefs.includes("src/foo.test.ts"), `boosted should include foo.test.ts, got: ${plan.boostedRefs}`);
	assert.ok(plan.armedKeys.includes("bash:npm test"), `should arm npm test, got: ${plan.armedKeys}`);
	assert.ok(plan.suppressedKeys.includes("bash:npm run lint"), `should suppress lint, got: ${plan.suppressedKeys}`);
	// Reasons must be human-readable receipts.
	const lintReason = plan.reasons.find(([k]) => k === "bash:npm run lint");
	assert.ok(lintReason && /rejections/.test(lintReason[1]), `lint reason should mention rejections, got: ${lintReason?.[1]}`);
});

test("applyPlanToEvidence merges boosted refs without exceeding budget", async () => {
	const evidence = {
		refs: ["src/foo.ts"],
		changed: [],
		intentTags: ["test"],
		confidence: 0.4,
		draftHash: "x",
	};
	const plan = {
		boostedRefs: ["src/foo.test.ts", "src/helpers.ts"],
		boostedIntentTags: [],
		armedKeys: [],
		suppressedKeys: [],
		matchedPatterns: [],
		reasons: [],
		elapsedMs: 0,
	};
	const merged = applyPlanToEvidence(evidence, plan);
	assert.ok(merged.refs.includes("src/foo.ts"));
	assert.ok(merged.refs.includes("src/foo.test.ts"));
	assert.ok(merged.refs.includes("src/helpers.ts"));
	assert.ok(merged.confidence >= 0.3);
});

test("planAnticipation injects intent tags from paid-off patterns when draft is tag-empty", async (t) => {
	const cwd = await makeCwd(t);
	await seedLibrary(cwd, {
		version: 1,
		project: "demo",
		updatedAt: Date.now(),
		patterns: [
			{
				id: "build-preflight",
				label: "build/typecheck-preflight",
				project: "demo",
				refs: ["src/db.ts"],
				intentTags: ["build"],
				count: 4,
				confidence: 0.6,
				futures: [
					{ key: "bash:npm typecheck", armed: 4, hits: 3, misses: 0, rejections: 0, savedMs: 4200, lastSeenAt: Date.now() },
				],
				createdAt: Date.now(),
				updatedAt: Date.now(),
			},
		],
		events: [],
	});
	const evidence = {
		refs: ["src/db.ts"],
		changed: [],
		intentTags: [], // tag-empty draft: "update the query helper in src/db.ts"
		confidence: 0.3,
		draftHash: "x",
	};
	const plan = await planAnticipation(cwd, evidence);
	assert.ok(plan.boostedIntentTags.includes("build"), `should inject build tag, got: ${plan.boostedIntentTags}`);
	const merged = applyPlanToEvidence(evidence, plan);
	assert.ok(merged.intentTags.includes("build"), "applyPlanToEvidence merges intent tags");
});

test("evaluateExpensiveFutures arms library-backed bash futures alongside hardcoded ones", async (t) => {
	const cwd = await makeCwd(t);
	await writeFile(join(cwd, "package.json"), JSON.stringify({
		name: "demo",
		scripts: { test: "node --test", typecheck: "tsc --noEmit" },
	}));
	await seedLibrary(cwd, {
		version: 1,
		project: "demo",
		updatedAt: Date.now(),
		patterns: [
			{
				id: "p1",
				label: "test-after-edit",
				project: "demo",
				refs: ["src/foo.ts"],
				intentTags: ["test"],
				count: 3,
				confidence: 0.5,
				futures: [
					{ key: "bash:npm run test:integration", armed: 3, hits: 2, misses: 0, rejections: 0, savedMs: 9000, lastSeenAt: Date.now() },
				],
				createdAt: Date.now(),
				updatedAt: Date.now(),
			},
		],
		events: [],
	});
	const event = {
		at: Date.now(),
		cwd,
		changed: ["src/foo.ts"],
		added: ["src/foo.ts"],
		removed: [],
		modified: [],
	};
	const verdict = await evaluateExpensiveFutures(cwd, event);
	const libraryArmed = verdict.armed.find((line) => line.includes("test:integration"));
	assert.ok(libraryArmed, `library-backed future should appear in armed list, got: ${verdict.armed.join(" | ")}`);
	assert.ok(verdict.armed.some((line) => line.startsWith("bash:npm test")), "hardcoded npm test should still arm");
});
