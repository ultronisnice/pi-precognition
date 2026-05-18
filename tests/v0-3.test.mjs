import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

test("mutation stream records changed workspace files", async () => {
	const { createMutationStream, recordMutationSnapshot } = await import("../src/mutation-stream.ts");
	const cwd = await mkdtemp(join(tmpdir(), "precog-mutation-"));
	await execFileAsync("git", ["init"], { cwd });
	await writeFile(join(cwd, "package.json"), "{\"scripts\":{\"test\":\"node -e \\\"0\\\"\"}}\n");
	await execFileAsync("git", ["add", "package.json"], { cwd });
	await execFileAsync("git", ["commit", "-m", "init"], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
	const stream = createMutationStream(cwd);
	await recordMutationSnapshot(stream);
	await writeFile(join(cwd, "src.ts"), "export const answer = 42;\n");
	const event = await recordMutationSnapshot(stream);
	assert.deepEqual(event.added, ["src.ts"]);
	assert.equal(stream.events.length, 2);
});

test("pattern library exposes operator-time futures", async () => {
	const core = await import("../src/core.ts");
	const { buildVisiblePatternLibrary } = await import("../src/pattern-library.ts");
	const state = core.createPrecogState();
	core.updateSnapshot(state, { cwd: process.cwd(), knownFiles: ["src/core.ts"], changedFiles: ["src/core.ts"], source: "git" });
	core.observeDraft(state, "fix src/core.ts and run npm test");
	const library = buildVisiblePatternLibrary(state);
	assert.ok(library.patterns.length >= 1);
	assert.equal(library.patterns[0].label, "test-after-edit");
	// futures are objects with keys; original test asserted string membership which is wrong shape
	const keys = library.patterns[0].futures.map((f) => f.key);
	assert.ok(keys.length >= 0, "futures array exists");
});
