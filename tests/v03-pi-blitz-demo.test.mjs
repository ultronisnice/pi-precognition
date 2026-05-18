import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const CLI = new URL("../src/cli.ts", import.meta.url).pathname;

test("RED: patterns CLI surfaces learned pi_blitz futures by name", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "precog-blitz-"));
	const dir = join(cwd, ".pi-precognition");
	await mkdir(dir, { recursive: true });
	const now = Date.now();
	const library = {
		version: 1, project: "fx", updatedAt: now, events: [],
		patterns: [{
			id: "p1", label: "test-after-edit", project: "fx",
			refs: ["src/core.ts"], intentTags: ["test", "debug"],
			count: 4, confidence: 0.7, createdAt: now, updatedAt: now,
			futures: [
				{ key: "pi_blitz:edit", armed: 4, hits: 3, misses: 0, rejections: 1, savedMs: 18000, lastSeenAt: now },
				{ key: "bash:npm test", armed: 4, hits: 2, misses: 0, rejections: 0, savedMs: 12000, lastSeenAt: now },
			],
		}],
	};
	await writeFile(join(dir, "patterns.json"), JSON.stringify(library, null, 2));
	const { stdout } = await execFileAsync("node", [CLI, "patterns", "--cwd", cwd]);
	assert.match(stdout, /pi_blitz:edit/, "pi_blitz future class must be surfaced by name in patterns output");
	assert.match(stdout, /pi_blitz:edit a4\/h3\/r1|pi_blitz:edit\s+a4/i, "pi_blitz armed/hit counts must be visible");
});
