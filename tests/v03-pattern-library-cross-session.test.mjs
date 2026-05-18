import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const CLI = new URL("../src/cli.ts", import.meta.url).pathname;

async function seedLibrary(cwd, patterns) {
	const dir = join(cwd, ".pi-precognition");
	await mkdir(dir, { recursive: true });
	const file = join(dir, "patterns.json");
	const library = { version: 1, project: "fixture", updatedAt: Date.now(), patterns, events: [] };
	await writeFile(file, JSON.stringify(library, null, 2));
	return file;
}

function makePattern(id, label, opts) {
	const now = Date.now();
	return {
		id,
		label,
		project: "fixture",
		refs: opts.refs ?? [],
		intentTags: opts.intentTags ?? [],
		count: opts.count ?? 1,
		confidence: opts.confidence ?? 0.5,
		createdAt: now,
		updatedAt: now,
		futures: opts.futures ?? [],
	};
}

function future(key, opts) {
	return {
		key,
		armed: opts.armed ?? 0,
		hits: opts.hits ?? 0,
		misses: opts.misses ?? 0,
		rejections: opts.rejections ?? 0,
		savedMs: opts.savedMs ?? 0,
		lastSeenAt: Date.now(),
	};
}

test("RED: patterns CLI surfaces a library-wide usefulness summary across cold-start sessions", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "precog-red-summary-"));
	await seedLibrary(cwd, [
		makePattern("p1", "test-after-edit", {
			count: 5,
			confidence: 0.8,
			futures: [future("bash:npm test", { armed: 5, hits: 4, rejections: 1, savedMs: 32000 })],
		}),
		makePattern("p2", "build/typecheck-preflight", {
			count: 3,
			confidence: 0.6,
			futures: [future("bash:npm run typecheck", { armed: 3, hits: 2, savedMs: 18000 })],
		}),
	]);
	const { stdout } = await execFileAsync("node", [CLI, "patterns", "--cwd", cwd]);
	assert.match(stdout, /2 patterns/, "shows pattern count");
	assert.match(stdout, /6 hits|hits 6|6\s*\/\s*8|6 of 8/i, "library-wide hit total (6) must be visible");
	assert.match(stdout, /50\.0?s|50000ms|saved\s+\D*50/i, "library-wide saved-time total (~50s) must be visible");
});

test("RED: each ranked pattern surfaces a readable hit-rate when hits > 0", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "precog-red-hitrate-"));
	await seedLibrary(cwd, [
		makePattern("p1", "test-after-edit", {
			count: 4,
			confidence: 0.7,
			futures: [future("bash:npm test", { armed: 4, hits: 3, rejections: 1, savedMs: 24000 })],
		}),
	]);
	const { stdout } = await execFileAsync("node", [CLI, "patterns", "--cwd", cwd]);
	assert.match(stdout, /75%|hit-rate\s*75|3\s*\/\s*4 hits|3 of 4 hits/i, "readable hit-rate (75% or 3/4 hits) must be visible");
});

test("RED: patterns CLI ranks high-utility patterns above noise across sessions", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "precog-red-rank-"));
	await seedLibrary(cwd, [
		makePattern("noise", "operator-rhythm", { count: 12, confidence: 0.25, futures: [] }),
		makePattern("hero", "test-after-edit", {
			count: 2,
			confidence: 0.7,
			futures: [future("bash:npm test", { armed: 2, hits: 2, savedMs: 28000 })],
		}),
	]);
	const { stdout } = await execFileAsync("node", [CLI, "patterns", "--cwd", cwd]);
	const heroIdx = stdout.indexOf("test-after-edit");
	const noiseIdx = stdout.indexOf("operator-rhythm");
	assert.ok(heroIdx >= 0 && noiseIdx >= 0, "both patterns must appear");
	assert.ok(heroIdx < noiseIdx, "high-utility pattern (hits + saved) must rank above no-utility noise");
});
