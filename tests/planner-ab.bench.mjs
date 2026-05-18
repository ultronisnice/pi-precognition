/**
 * A/B harness — Anticipation Planner vs no planner.
 *
 * Real measurement, no mocks:
 *   - Builds an ephemeral git repo with realistic files (src + tests).
 *   - Seeds .pi-precognition/patterns.json with paid-off history.
 *   - For N iterations, on each draft:
 *       OFF arm: observeDraft → warmReadOnlyEvidence → warmGhostTools
 *       ON  arm: observeDraft → planAnticipation → applyPlanToEvidence
 *                                → warmReadOnlyEvidence → warmGhostTools
 *     then tryGhostToolCache for the expected future. Measure:
 *       - warm-time (operator-time, paid during draft)
 *       - cache-hit?  (yes = first-tool-wait collapses to ~0)
 *       - boostedRefs count
 *       - armed futures count
 *
 * Output: raw JSON to /tmp/precog-planner-ab.json + a readable summary.
 */

import { performance } from "node:perf_hooks";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Enable command futures BEFORE importing core so its module-level checks see them.
process.env.PI_PRECOG_COMMAND_FUTURES = "1";
process.env.PI_PRECOG_TOOL_CACHE = "1";

const core = await import("../src/core.ts");
const { planAnticipation, applyPlanToEvidence } = await import("../src/anticipation-planner.ts");

const ITERATIONS = Number(process.env.AB_ITERATIONS ?? 20);

async function buildFixture() {
	const dir = await mkdtemp(join(tmpdir(), "precog-ab-"));
	await execFileAsync("git", ["init", "-q"], { cwd: dir });
	await execFileAsync("git", ["config", "user.email", "ab@example.com"], { cwd: dir });
	await execFileAsync("git", ["config", "user.name", "ab"], { cwd: dir });

	await mkdir(join(dir, "src"), { recursive: true });
	await mkdir(join(dir, "tests"), { recursive: true });

	// Source: realistic-sized files so reads are non-trivial
	const padding = "// padding-line that makes the file realistic\n".repeat(120);
	await writeFile(join(dir, "src/auth.ts"), `${padding}export function login(user: string) { return user; }\n`);
	await writeFile(join(dir, "src/db.ts"), `${padding}export function query(sql: string) { return [sql]; }\n`);
	await writeFile(join(dir, "src/helpers.ts"), `${padding}export const helper = () => 42;\n`);
	await writeFile(join(dir, "tests/auth.test.ts"), `import { login } from "../src/auth.ts";\nimport { helper } from "../src/helpers.ts";\n${padding}\n`);
	await writeFile(join(dir, "tests/db.test.ts"), `import { query } from "../src/db.ts";\n${padding}\n`);

	// Realistic-cost scripts: small sleep to simulate test/typecheck startup.
	// 400ms is conservative — real test suites are seconds.
	await writeFile(join(dir, "package.json"), JSON.stringify({
		name: "ab-fixture",
		scripts: {
			test: "node -e \"setTimeout(()=>console.log('ok'),400)\"",
			typecheck: "node -e \"setTimeout(()=>console.log('ok'),300)\"",
			lint: "echo ok",
		},
	}, null, 2));

	await execFileAsync("git", ["add", "."], { cwd: dir });
	await execFileAsync("git", ["commit", "-qm", "init"], { cwd: dir });

	// Touch one file post-commit so it appears in `git status --short`
	await writeFile(join(dir, "src/auth.ts"), `${padding}export function login(user: string) { return user.trim(); }\n`);

	return dir;
}

async function seedLibrary(dir) {
	await mkdir(join(dir, ".pi-precognition"), { recursive: true });
	const now = Date.now();
	const library = {
		version: 1,
		project: "ab-fixture",
		updatedAt: now,
		patterns: [
			{
				id: "test-after-edit-auth",
				label: "test-after-edit",
				project: "ab-fixture",
				// Operator history: when they touch src/auth.ts they also read tests/auth.test.ts
				// and src/helpers.ts, then run npm test.
				refs: ["src/auth.ts", "tests/auth.test.ts", "src/helpers.ts"],
				intentTags: ["test"],
				count: 8,
				confidence: 0.7,
				futures: [
					{ key: "read:tests/auth.test.ts", armed: 8, hits: 6, misses: 1, rejections: 0, savedMs: 480, lastSeenAt: now },
					{ key: "read:src/helpers.ts",     armed: 8, hits: 5, misses: 2, rejections: 0, savedMs: 320, lastSeenAt: now },
					{ key: "bash:npm test",           armed: 8, hits: 5, misses: 1, rejections: 0, savedMs: 9500, lastSeenAt: now },
					{ key: "bash:npm run lint",       armed: 3, hits: 0, misses: 0, rejections: 5, savedMs: 0,    lastSeenAt: now },
				],
				createdAt: now - 60_000,
				updatedAt: now,
			},
			{
				id: "build-preflight",
				label: "build/typecheck-preflight",
				project: "ab-fixture",
				refs: ["src/db.ts", "tests/db.test.ts"],
				intentTags: ["build"],
				count: 4,
				confidence: 0.5,
				futures: [
					{ key: "bash:npm run typecheck", armed: 4, hits: 3, misses: 0, rejections: 0, savedMs: 4200, lastSeenAt: now },
				],
				createdAt: now - 30_000,
				updatedAt: now,
			},
		],
		events: [],
	};
	await writeFile(join(dir, ".pi-precognition", "patterns.json"), JSON.stringify(library, null, 2));
}

// Two realistic operator drafts. Each mentions ONE file the library has
// strong history on — the planner should boost the historical co-referenced
// files into the warm set.
const DRAFTS = [
	{
		name: "auth-edit",
		text: "fix the login bug in src/auth.ts and run the tests",
		// The bash command the operator would run after the edit.
		future: { command: "npm test", classKey: "bash:npm test" },
		// Files we expect the planner to boost (library history says so).
		expectedBoosts: ["tests/auth.test.ts", "src/helpers.ts"],
	},
	{
		name: "db-edit",
		text: "update the query helper in src/db.ts",
		future: { command: "npm run typecheck", classKey: "bash:npm run typecheck" },
		expectedBoosts: ["tests/db.test.ts"],
	},
];

async function runArm({ cwd, draft, useplanner }) {
	const state = core.createPrecogState();
	await core.refreshGitSnapshot(state, cwd).catch(() => undefined);

	const warmStart = performance.now();
	const rawEvidence = core.observeDraft(state, draft.text);

	let planSummary = { boostedRefs: 0, armedKeys: 0, suppressedKeys: 0, planMs: 0, matchedPatterns: 0 };
	let evidence = rawEvidence;
	if (useplanner && rawEvidence) {
		const plan = await planAnticipation(cwd, rawEvidence);
		evidence = applyPlanToEvidence(rawEvidence, plan) ?? rawEvidence;
		planSummary = {
			boostedRefs: plan.boostedRefs.length,
			armedKeys: plan.armedKeys.length,
			suppressedKeys: plan.suppressedKeys.length,
			planMs: Number(plan.elapsedMs.toFixed(3)),
			matchedPatterns: plan.matchedPatterns.length,
		};
	}

	await Promise.allSettled([
		core.warmReadOnlyEvidence(state, cwd, evidence),
		core.warmGhostTools(state, cwd, evidence),
	]);
	const warmMs = Number((performance.now() - warmStart).toFixed(3));

	// Count how many of the expected-boost files actually got warmed.
	const warmedPaths = new Set(state.warmedFiles.map((f) => f.path));
	const ghostPaths = new Set(state.ghostTools.filter((t) => t.path).map((t) => t.path));
	const boostHits = draft.expectedBoosts.filter((p) => warmedPaths.has(p) || ghostPaths.has(p)).length;

	// THE ACTUAL VALUE: simulate the operator's next tool calls (the
	// historically-co-referenced files + the expensive command). Each is
	// timed independently: cache-hit ⇒ near-zero wait, miss ⇒ full cost.
	const firstWaitsMs = [];
	const hits = [];

	// Read-future probes
	for (const path of draft.expectedBoosts) {
		const start = performance.now();
		const hit = core.tryGhostToolCache(state, "read", { path });
		if (hit) {
			hits.push(path);
			firstWaitsMs.push(Number((performance.now() - start).toFixed(3)));
		} else {
			const { readFile } = await import("node:fs/promises");
			await readFile(join(cwd, path), "utf8").catch(() => undefined);
			firstWaitsMs.push(Number((performance.now() - start).toFixed(3)));
		}
	}

	// Command-future probe — this is where the big wins live.
	let commandWaitMs = 0;
	let commandHit = false;
	if (draft.future?.command) {
		const start = performance.now();
		const hit = await core.tryGhostToolCacheAsync(state, "bash", { command: draft.future.command });
		if (hit) {
			commandHit = true;
			commandWaitMs = Number((performance.now() - start).toFixed(3));
		} else {
			// pay the real cold cost
			await execFileAsync("npm", draft.future.command.split(" ").slice(1), {
				cwd, timeout: 10_000, maxBuffer: 64 * 1024,
			}).catch(() => undefined);
			commandWaitMs = Number((performance.now() - start).toFixed(3));
		}
	}

	const firstWaitTotalMs = Number(
		(firstWaitsMs.reduce((a, b) => a + b, 0) + commandWaitMs).toFixed(3),
	);

	return {
		warmMs,
		warmedFiles: state.warmedFiles.length,
		ghostTools: state.ghostTools.length,
		boostHits,
		expectedBoosts: draft.expectedBoosts.length,
		firstWaitTotalMs,
		cacheHits: hits.length,
		commandHit,
		commandWaitMs,
		plan: planSummary,
	};
}

async function main() {
	const cwd = await buildFixture();
	await seedLibrary(cwd);

	const samples = { off: [], on: [] };
	for (let i = 0; i < ITERATIONS; i += 1) {
		for (const draft of DRAFTS) {
			samples.off.push({ draft: draft.name, ...(await runArm({ cwd, draft, useplanner: false })) });
			samples.on.push({ draft: draft.name, ...(await runArm({ cwd, draft, useplanner: true })) });
		}
	}

	const summarize = (arm) => {
		const byDraft = {};
		for (const s of arm) {
			byDraft[s.draft] ??= { warm: [], firstWait: [], hits: 0, cmdHits: 0, boostHit: 0, expected: 0, planMs: [], boosted: 0 };
			byDraft[s.draft].warm.push(s.warmMs);
			byDraft[s.draft].firstWait.push(s.firstWaitTotalMs);
			byDraft[s.draft].hits += s.cacheHits;
			byDraft[s.draft].cmdHits += s.commandHit ? 1 : 0;
			byDraft[s.draft].boostHit += s.boostHits;
			byDraft[s.draft].expected += s.expectedBoosts;
			byDraft[s.draft].planMs.push(s.plan.planMs);
			byDraft[s.draft].boosted += s.plan.boostedRefs;
		}
		const out = {};
		for (const [name, d] of Object.entries(byDraft)) {
			const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
			out[name] = {
				warmAvgMs: Number(avg(d.warm).toFixed(3)),
				warmMinMs: Number(Math.min(...d.warm).toFixed(3)),
				warmMaxMs: Number(Math.max(...d.warm).toFixed(3)),
				firstWaitAvgMs: Number(avg(d.firstWait).toFixed(3)),
				firstWaitMinMs: Number(Math.min(...d.firstWait).toFixed(3)),
				firstWaitMaxMs: Number(Math.max(...d.firstWait).toFixed(3)),
				cacheHitRate: d.expected ? Number((d.hits / d.expected).toFixed(3)) : 0,
				commandHitRate: Number((d.cmdHits / d.warm.length).toFixed(3)),
				boostHitRate: d.expected ? Number((d.boostHit / d.expected).toFixed(3)) : 0,
				planAvgMs: Number(avg(d.planMs).toFixed(3)),
				avgBoostedRefs: Number((d.boosted / d.warm.length).toFixed(2)),
				samples: d.warm.length,
			};
		}
		return out;
	};

	const result = {
		generatedAt: new Date().toISOString(),
		iterations: ITERATIONS,
		cwd,
		off: summarize(samples.off),
		on: summarize(samples.on),
	};

	const outPath = "/tmp/precog-planner-ab.json";
	await writeFile(outPath, JSON.stringify(result, null, 2));

	// Readable summary
	const lines = [];
	lines.push(`A/B — Anticipation Planner (n=${ITERATIONS} × ${DRAFTS.length} drafts = ${ITERATIONS * DRAFTS.length} samples per arm)`);
	lines.push("");
	for (const draft of DRAFTS) {
		const off = result.off[draft.name];
		const on = result.on[draft.name];
		const firstWaitSpeedup = off.firstWaitAvgMs / Math.max(on.firstWaitAvgMs, 0.001);
		const warmCostDelta = on.warmAvgMs - off.warmAvgMs;
		// operator-time perceived saved: warm overlaps with drafting, so what the
		// operator FEELS is just the change in first-tool-wait. Warm-cost is paid
		// in parallel with typing ("the wait you don't see").
		const operatorTimeSavedMs = off.firstWaitAvgMs - on.firstWaitAvgMs;
		lines.push(`[${draft.name}]`);
		lines.push(`  OFF: warm ${off.warmAvgMs}ms · first-tool-wait ${off.firstWaitAvgMs}ms (read-hits ${(off.cacheHitRate * 100).toFixed(0)}% / cmd-hits ${(off.commandHitRate * 100).toFixed(0)}%)`);
		lines.push(`  ON : warm ${on.warmAvgMs}ms · first-tool-wait ${on.firstWaitAvgMs}ms (read-hits ${(on.cacheHitRate * 100).toFixed(0)}% / cmd-hits ${(on.commandHitRate * 100).toFixed(0)}%)`);
		lines.push(`       planner cost ${on.planAvgMs}ms · boosted ${on.avgBoostedRefs} refs/draft`);
		lines.push(`       first-tool-wait speedup: ${firstWaitSpeedup.toFixed(2)}x · operator-time saved/turn: ${operatorTimeSavedMs.toFixed(1)}ms · background warm-cost: +${warmCostDelta.toFixed(1)}ms`);
		lines.push("");
	}
	console.log(lines.join("\n"));
	console.log(`raw json: ${outPath}`);

	await rm(cwd, { recursive: true, force: true });
}

await main();
