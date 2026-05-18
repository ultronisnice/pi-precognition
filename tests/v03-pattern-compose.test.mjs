import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("v0.3 Pattern Library persists ranked futures across sessions", async () => {
	const core = await import("../src/core.ts");
	const patterns = await import("../src/pattern-library.ts");
	const cwd = await mkdtemp(join(tmpdir(), "precog-patterns-"));
	const state = core.createPrecogState();
	core.updateSnapshot(state, { cwd, knownFiles: ["src/core.ts"], changedFiles: ["src/core.ts"], source: "git" });
	const evidence = core.observeDraft(state, "fix src/core.ts and run npm test");
	await patterns.observePattern(cwd, { evidence, ghostTools: [{ name: "bash_command", key: "bash:npm test", args: ["npm test"], content: "ok", bytes: 2, collectedAt: Date.now() }] });
	await patterns.recordFutureOutcome(cwd, "bash:npm test", "hit", { savedMs: 15000 });
	const loaded = await patterns.loadPatternLibrary(cwd);
	assert.equal(loaded.patterns[0].label, "test-after-edit");
	const npmTest = loaded.patterns[0].futures.find((future) => future.key === "bash:npm test");
	assert.equal(npmTest?.hits, 1);
	assert.equal(npmTest?.savedMs, 15000);
});

test("v0.3 Future Compose API supports external future classes", async () => {
	const core = await import("../src/core.ts");
	const compose = await import("../src/future-compose.ts");
	compose.registerFutureClass({
		key: "example:docs-preview",
		label: "Docs preview",
		kind: "command",
		intentTags: ["docs"],
		match: (evidence) => evidence.refs.some((path) => path.endsWith(".md")),
		describe: (evidence) => `preview ${evidence.refs.join(",")}`,
	});
	const evidence = core.analyzeDraft("update README.md docs", { knownFiles: ["README.md"], source: "git" });
	const futures = compose.composeFutures(evidence);
	assert.ok(futures.some((future) => future.key === "example:docs-preview"));
});

test("v0.3 built-in compose learns pi_blitz edit/batch futures", async () => {
	const core = await import("../src/core.ts");
	const compose = await import("../src/future-compose.ts");
	const editEvidence = core.analyzeDraft("fix src/core.ts and review the diff", { knownFiles: ["src/core.ts"], source: "git" });
	assert.ok(compose.composeFutures(editEvidence).some((future) => future.key === "pi_blitz:edit"));
	const batchEvidence = core.analyzeDraft("refactor src/core.ts src/index.ts and run typecheck", { knownFiles: ["src/core.ts", "src/index.ts"], changedFiles: ["src/core.ts", "src/index.ts"], source: "git" });
	assert.ok(compose.composeFutures(batchEvidence).some((future) => future.key === "pi_blitz:batch"));
});
