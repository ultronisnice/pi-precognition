import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);
const CLI = new URL("../src/cli.ts", import.meta.url).pathname;

async function seedProject(opts) {
	const cwd = await mkdtemp(join(tmpdir(), "precog-mut-"));
	await writeFile(join(cwd, "package.json"), JSON.stringify(opts.pkg, null, 2));
	if (opts.touch) {
		for (const path of opts.touch) {
			await mkdir(join(cwd, path.split("/").slice(0, -1).join("/") || "."), { recursive: true });
			await writeFile(join(cwd, path), "// fixture\n");
		}
	}
	return cwd;
}

test("RED: watch arms expensive futures when scripts exist and a .ts file changed", async () => {
	const cwd = await seedProject({
		pkg: { name: "fx", scripts: { test: "node --test", typecheck: "tsc --noEmit" } },
		touch: ["src/foo.ts"],
	});
	const { stdout } = await execFileAsync("node", [CLI, "watch", "--once", "--cwd", cwd]);
	assert.match(stdout, /armed:.*test|test.*armed|expensive: test/i, "expensive futures must be visibly armed");
	assert.match(stdout, /typecheck/i, "typecheck must appear in the live arm list");
});

test("RED: watch rejects test future with a human-readable reason when no scripts.test exists", async () => {
	const cwd = await seedProject({
		pkg: { name: "fx", scripts: { build: "tsc" } },
		touch: ["src/foo.ts"],
	});
	const { stdout } = await execFileAsync("node", [CLI, "watch", "--once", "--cwd", cwd]);
	assert.match(stdout, /reject(ed)?:.*test|test.*reject(ed)?/i, "test future must be rejected");
	assert.match(stdout, /no\s+(scripts\.)?test|missing\s+test|no\s+test\s+script/i, "rejection reason must be human-readable");
});

test("RED: watch rejects expensive futures when nothing relevant changed", async () => {
	const cwd = await seedProject({
		pkg: { name: "fx", scripts: { test: "node --test", typecheck: "tsc --noEmit" } },
		touch: [],
	});
	const { stdout } = await execFileAsync("node", [CLI, "watch", "--once", "--cwd", cwd]);
	assert.match(stdout, /no\s+(relevant\s+)?changes|nothing\s+to\s+arm|no\s+source\s+changes/i, "rejection reason must say nothing relevant changed");
});
