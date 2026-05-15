import assert from "node:assert/strict";
import { test } from "node:test";

test("precognition core analyzes high-signal file drafts", async () => {
	const core = await import("../src/core.ts");
	const evidence = core.analyzeDraft("fix src/core.ts and run tests", {
		knownFiles: ["src/core.ts"],
		collectedAt: Date.now(),
		source: "git",
	});

	assert.equal(evidence.refs[0], "src/core.ts");
	assert.ok(evidence.intentTags.includes("test"));
	assert.ok(evidence.confidence >= 0.25);
});

