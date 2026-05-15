import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, before, after } from "node:test";
import { promisify } from "node:util";

const MOD = "../src/precognition.ts";

// Phase 0: Test isolation fix.
// Inherited live env vars (e.g. PI_PRECOG_INJECTION_MODE=silent-futures,
// PI_PRECOG_TOOL_CACHE=1, PI_PRECOG_COMMAND_FUTURES=1) used to silently break
// these tests, which assert against the default "full" injection mode.
// We pin the env to known defaults at suite start and restore at suite end.
const SAVED_ENV_KEYS = [
	"PI_PRECOG",
	"PI_PRECOG_INJECTION_MODE",
	"PI_PRECOG_TOOL_CACHE",
	"PI_PRECOG_COMMAND_FUTURES",
	"PI_PRECOG_PRIME_DRAFT",
	"PI_PRECOG_PRIME_BUDGET_MS",
	"PI_PRECOG_SUBMIT_WARM_BUDGET_MS",
	"PI_PRECOG_DEBOUNCE_MS",
	"PI_PRECOG_TTL_MS",
	"PI_PRECOG_LOG",
];
const SAVED_ENV = {};
before(() => {
	for (const k of SAVED_ENV_KEYS) {
		SAVED_ENV[k] = process.env[k];
		delete process.env[k];
	}
});
after(() => {
	for (const k of SAVED_ENV_KEYS) {
		if (SAVED_ENV[k] === undefined) delete process.env[k];
		else process.env[k] = SAVED_ENV[k];
	}
});
const execFileAsync = promisify(execFile);

test("precognition extracts path evidence and stays observational", async () => {
	const {
		analyzeDraft,
		assertObservationLanguage,
		buildInjection,
	} = await import(MOD);

	const evidence = analyzeDraft("fix src/core.ts and run the failing test", {
		changedFiles: ["src/core.ts", "README.md"],
		knownFiles: ["src/core.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const injection = buildInjection(evidence);

	assert.equal(injection.customType, "pi-precognition");
	assert.equal(injection.display, false);
	assert.match(injection.content, /draft mentions paths: src\/core\.ts/);
	assert.match(injection.content, /intent words observed: test, debug/);
	assert.ok(assertObservationLanguage(injection.content), injection.content);
});

test("precognition treats one explicit file reference as enough signal", async () => {
	const { analyzeDraft, buildInjection } = await import(MOD);
	const evidence = analyzeDraft("Refactor src/router.ts to remove duplicated branching.", {
		knownFiles: ["src/router.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const injection = buildInjection(evidence);

	assert.equal(evidence.confidence >= 0.25, true);
	assert.equal(injection.customType, "pi-precognition");
	assert.match(injection.content, /src\/router\.ts/);
});

test("precognition duplicate drafts reuse cached evidence", async () => {
	const {
		createPrecogState,
		observeDraft,
		updateSnapshot,
	} = await import(MOD);

	const state = createPrecogState();
	updateSnapshot(state, {
		changedFiles: ["src/precognition.ts"],
		knownFiles: ["src/precognition.ts"],
		collectedAt: Date.now(),
		source: "git",
	});

	observeDraft(state, "review src/precognition.ts", 1_000);
	observeDraft(state, "review src/precognition.ts", 1_050);

	assert.equal(state.stats.analyzed, 1);
	assert.equal(state.stats.duplicateDrafts, 1);
	assert.equal(state.stats.cacheHits, 1);
});

test("precognition extension registers a cheap peek tool and emits hidden context only when useful", async () => {
	const { default: installPrecognition } = await import("../extensions/precognition.ts");
	const registeredTools = new Map();
	const handlers = new Map();
	const ui = {
		onTerminalInput() {
			return () => {};
		},
		setStatus() {},
		setWidget() {},
		getEditorText() {
			return "fix src/precognition.ts";
		},
	};
	const pi = {
		registerTool(tool) {
			registeredTools.set(tool.name, tool);
		},
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
	};

	installPrecognition(pi);
	assert.equal(registeredTools.has("precognition_peek"), true);

	const sessionStart = handlers.get("session_start")?.[0];
	await sessionStart?.({ type: "session_start", reason: "startup" }, {
		hasUI: true,
		cwd: process.cwd(),
		ui,
	});

	const before = handlers.get("before_agent_start")?.[0];
	const result = await before?.({
		type: "before_agent_start",
		prompt: "fix src/precognition.ts and run tests",
		systemPrompt: "base",
		systemPromptOptions: {},
	});

	assert.equal(result.message.customType, "pi-precognition");
	assert.equal(result.message.display, false);

	const peek = await registeredTools.get("precognition_peek").execute("peek-1", {}, undefined, undefined, {});
	assert.equal(peek.content[0].type, "text");
	assert.match(peek.content[0].text, /draftsSeen|analyzed/);
});

test("precognition extension JIT-warms evidence for noninteractive submit paths", async () => {
	const { default: installPrecognition } = await import("../extensions/precognition.ts");
	const registeredTools = new Map();
	const handlers = new Map();
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-jit-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/jit.ts"), "export const warmed = true;\n");
	const pi = {
		registerTool(tool) {
			registeredTools.set(tool.name, tool);
		},
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
	};
	const prev = process.env.PI_PRECOG_SUBMIT_WARM_BUDGET_MS;
	process.env.PI_PRECOG_SUBMIT_WARM_BUDGET_MS = "250";
	try {
		delete globalThis.__pi_precognition_loaded__;
		installPrecognition(pi);
		await handlers.get("session_start")?.[0]?.({ type: "session_start" }, { hasUI: false, cwd: dir });
		const result = await handlers.get("before_agent_start")?.[0]?.({
			type: "before_agent_start",
			prompt: "fix src/jit.ts and run tests",
		});
		assert.match(result.message.content, /warmed read-only evidence|ghost tool results/);
		assert.match(result.message.content, /src\/jit\.ts/);
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_SUBMIT_WARM_BUDGET_MS;
		else process.env.PI_PRECOG_SUBMIT_WARM_BUDGET_MS = prev;
	}
});

test("precognition extension can prime verified futures during draft time before submit", async () => {
	const { default: installPrecognition } = await import("../extensions/precognition.ts");
	const registeredTools = new Map();
	const handlers = new Map();
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-prime-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/prime.ts"), "export const primedFuture = 42;\n");
	const pi = {
		registerTool(tool) {
			registeredTools.set(tool.name, tool);
		},
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
	};
	const prevPrime = process.env.PI_PRECOG_PRIME_DRAFT;
	const prevCache = process.env.PI_PRECOG_TOOL_CACHE;
	const prevBudget = process.env.PI_PRECOG_SUBMIT_WARM_BUDGET_MS;
	const prevMode = process.env.PI_PRECOG_INJECTION_MODE;
	process.env.PI_PRECOG_PRIME_DRAFT = "read src/prime.ts";
	process.env.PI_PRECOG_TOOL_CACHE = "1";
	process.env.PI_PRECOG_SUBMIT_WARM_BUDGET_MS = "0";
	process.env.PI_PRECOG_INJECTION_MODE = "silent-futures";
	try {
		delete globalThis.__pi_precognition_loaded__;
		installPrecognition(pi);
		await handlers.get("session_start")?.[0]?.({ type: "session_start" }, { hasUI: false, cwd: dir });
		const result = await handlers.get("before_agent_start")?.[0]?.({
			type: "before_agent_start",
			prompt: "read src/prime.ts",
		});
		assert.equal(result, undefined);
		const read = await registeredTools.get("read").execute("read-1", { path: "src/prime.ts" });
		assert.equal(read.details.precogCacheHit, true);
		assert.match(read.content[0].text, /primedFuture/);
	} finally {
		if (prevPrime === undefined) delete process.env.PI_PRECOG_PRIME_DRAFT;
		else process.env.PI_PRECOG_PRIME_DRAFT = prevPrime;
		if (prevCache === undefined) delete process.env.PI_PRECOG_TOOL_CACHE;
		else process.env.PI_PRECOG_TOOL_CACHE = prevCache;
		if (prevBudget === undefined) delete process.env.PI_PRECOG_SUBMIT_WARM_BUDGET_MS;
		else process.env.PI_PRECOG_SUBMIT_WARM_BUDGET_MS = prevBudget;
		if (prevMode === undefined) delete process.env.PI_PRECOG_INJECTION_MODE;
		else process.env.PI_PRECOG_INJECTION_MODE = prevMode;
	}
});

test("precognition extension awaits the startup git snapshot for headless implicit-source prompts", async () => {
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-implicit-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/price.ts"), "export function discounted(price, pct) { return price - pct; }\n");
	await execFileAsync("git", ["init"], { cwd: dir });
	await execFileAsync("git", ["add", "."], { cwd: dir });
	await execFileAsync("git", ["commit", "-m", "seed"], {
		cwd: dir,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "tester",
			GIT_AUTHOR_EMAIL: "tester@example.test",
			GIT_COMMITTER_NAME: "tester",
			GIT_COMMITTER_EMAIL: "tester@example.test",
		},
	});
	const script = [
		"import install from './extensions/precognition.ts';",
		"const handlers = new Map();",
		"const pi = { registerTool(){}, on(name, handler){ handlers.set(name, handler); } };",
		"install(pi);",
		"await handlers.get('session_start')?.({ type: 'session_start' }, { hasUI: false, cwd: process.env.TEST_REPO });",
		"const result = await handlers.get('before_agent_start')?.({ type: 'before_agent_start', prompt: 'Run the failing test, infer the source file, and fix the discounted price bug.' });",
		"console.log(JSON.stringify({ injected: Boolean(result?.message), content: result?.message?.content ?? '' }));",
	].join("\n");
	const { stdout } = await execFileAsync(process.execPath, ["-e", script], {
		cwd: new URL("..", import.meta.url),
		env: {
			...process.env,
			TEST_REPO: dir,
			PI_PRECOG_SNAPSHOT_BUDGET_MS: "500",
			PI_PRECOG_SUBMIT_WARM_BUDGET_MS: "500",
		},
	});
	const result = JSON.parse(stdout);

	assert.equal(result.injected, true);
	assert.match(result.content, /src\/price\.ts/);
});

test("precognition delayed snapshot refresh does not touch stale Pi ctx", async () => {
	const script = [
		"import install from './extensions/precognition.ts';",
		"const handlers = new Map();",
		"const pi = { registerTool(){}, on(name, handler){ handlers.set(name, handler); } };",
		"install(pi);",
		"let stale = false;",
		"const ctx = { hasUI: false, get cwd(){ if (stale) throw new Error('stale ctx read'); return process.cwd(); } };",
		"await handlers.get('session_start')?.({ type: 'session_start' }, ctx);",
		"stale = true;",
		"await new Promise((resolve) => setTimeout(resolve, 2700));",
		"console.log(JSON.stringify({ ok: true }));",
	].join("\n");
	const { stdout } = await execFileAsync(process.execPath, ["-e", script], {
		cwd: new URL("..", import.meta.url),
		env: { ...process.env, PI_PRECOG_TOOL_CACHE: "1" },
		timeout: 5_000,
	});
	assert.deepEqual(JSON.parse(stdout), { ok: true });
});

test("precognition ghost tool cache serves fresh warmed read futures", async () => {
	const {
		analyzeDraft,
		createPrecogState,
		tryGhostToolCache,
		updateSnapshot,
		warmGhostTools,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-cache-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/cache.ts"), "export const cached = 42;\n");

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/cache.ts"],
		knownFiles: ["src/cache.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("read src/cache.ts", state.snapshot);
	await warmGhostTools(state, dir, evidence);
	const result = tryGhostToolCache(state, "read", { path: "src/cache.ts" });

	assert.equal(result.details.precogCacheHit, true);
	assert.match(result.content[0].text, /cached = 42/);
	assert.equal(state.stats.toolCacheHits, 1);
});

test("precognition ghost read futures invalidate when the warmed file is deleted", async () => {
	const {
		analyzeDraft,
		createPrecogState,
		tryGhostToolCache,
		updateSnapshot,
		warmGhostTools,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-future-deleted-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/cache.ts"), "export const cached = 42;\n");

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/cache.ts"],
		knownFiles: ["src/cache.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("read src/cache.ts", state.snapshot);
	await warmGhostTools(state, dir, evidence);
	await fs.rm(join(dir, "src/cache.ts"));

	assert.equal(tryGhostToolCache(state, "read", { path: "src/cache.ts" }), undefined);
	assert.equal(state.stats.toolCacheMisses, 1);
});

test("precognition ghost read cache canonicalizes safe path aliases", async () => {
	const {
		analyzeDraft,
		createPrecogState,
		tryGhostToolCache,
		updateSnapshot,
		warmGhostTools,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-cache-alias-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/cache.ts"), "export const aliasCached = 42;\n");

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/cache.ts"],
		knownFiles: ["src/cache.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("read src/cache.ts", state.snapshot);
	await warmGhostTools(state, dir, evidence);

	for (const path of ["./src/cache.ts", "@src/cache.ts", join(dir, "src/cache.ts"), "src/cache.ts:1"]) {
		const result = tryGhostToolCache(state, "read", { path });
		assert.equal(result.details.precogCacheHit, true, `expected cache hit for ${path}`);
		assert.match(result.content[0].text, /aliasCached/);
	}

	assert.equal(tryGhostToolCache(state, "read", { path: join(tmpdir(), "outside.ts") }), undefined);
});

test("precognition ghost read futures invalidate when the warmed file changes", async () => {
	const {
		analyzeDraft,
		createPrecogState,
		tryGhostToolCache,
		updateSnapshot,
		warmGhostTools,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-future-stale-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/core.ts"), "export const futureAnswer = 42;\n");

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/core.ts"],
		knownFiles: ["src/core.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("read src/core.ts", state.snapshot);
	await warmGhostTools(state, dir, evidence);

	const fresh = tryGhostToolCache(state, "read", { path: "src/core.ts" });
	assert.equal(fresh?.details.precogCacheHit, true);

	await new Promise((resolve) => setTimeout(resolve, 5));
	await fs.writeFile(join(dir, "src/core.ts"), "export const futureAnswer = 43;\n");

	const stale = tryGhostToolCache(state, "read", { path: "src/core.ts" });
	assert.equal(stale, undefined);
	assert.equal(state.stats.toolCacheMisses, 1);
});

test("precognition ghost read cache refuses secret path aliases", async () => {
	const {
		createPrecogState,
		tryGhostToolCache,
		updateSnapshot,
	} = await import(MOD);
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-cache-secret-"));
	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: [".env"],
		knownFiles: [".env"],
		collectedAt: Date.now(),
		source: "git",
	});
	state.ghostTools = [{
		name: "read",
		key: "read:.env",
		args: [".env"],
		path: ".env",
		content: "SECRET=never",
		bytes: 12,
		collectedAt: Date.now(),
	}];

	assert.equal(tryGhostToolCache(state, "read", { path: ".env" }), undefined);
	assert.equal(tryGhostToolCache(state, "read", { path: join(dir, ".env") }), undefined);
});

test("precognition extension can register gated cached built-in overrides", async () => {
	const { default: installPrecognition } = await import("../extensions/precognition.ts");
	const registeredTools = new Map();
	const handlers = new Map();
	const prev = process.env.PI_PRECOG_TOOL_CACHE;
	process.env.PI_PRECOG_TOOL_CACHE = "1";
	try {
		delete globalThis.__pi_precognition_loaded__;
		installPrecognition({
			registerTool(tool) {
				registeredTools.set(tool.name, tool);
			},
			on(name, handler) {
				handlers.set(name, handler);
			},
		});
		await handlers.get("session_start")?.({ type: "session_start" }, { hasUI: false, cwd: process.cwd() });

		assert.equal(registeredTools.has("read"), true);
		assert.equal(registeredTools.has("bash"), true);
		assert.equal(registeredTools.has("grep"), true);
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_TOOL_CACHE;
		else process.env.PI_PRECOG_TOOL_CACHE = prev;
	}
});

test("precognition cached overrides preserve Pi built-in model-facing tool contracts", async () => {
	const { default: installPrecognition } = await import("../extensions/precognition.ts");
	// Robust path discovery: monorepo workspaces hoist deps to the root node_modules.
	async function findToolsModule() {
		const { existsSync } = await import("node:fs");
		const { dirname } = await import("node:path");
		let dir = process.cwd();
		for (let i = 0; i < 6; i++) {
			const candidate = join(dir, "node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js");
			if (existsSync(candidate)) return candidate;
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
		throw new Error("@earendil-works/pi-coding-agent not found in node_modules");
	}
	const toolsModule = await import(pathToFileURL(await findToolsModule()).href);
	const builtins = toolsModule.createAllToolDefinitions(process.cwd());
	const registeredTools = new Map();
	const handlers = new Map();
	const prev = process.env.PI_PRECOG_TOOL_CACHE;
	process.env.PI_PRECOG_TOOL_CACHE = "1";
	try {
		delete globalThis.__pi_precognition_loaded__;
		installPrecognition({
			registerTool(tool) {
				registeredTools.set(tool.name, tool);
			},
			on(name, handler) {
				handlers.set(name, handler);
			},
		});
		await handlers.get("session_start")?.({ type: "session_start" }, { hasUI: false, cwd: process.cwd() });

		for (const name of ["read", "bash", "grep"]) {
			const actual = registeredTools.get(name);
			const expected = builtins[name];
			assert.equal(actual.description, expected.description, `${name} description drifted`);
			assert.equal(actual.promptSnippet, expected.promptSnippet, `${name} promptSnippet drifted`);
			assert.deepEqual(actual.promptGuidelines, expected.promptGuidelines, `${name} promptGuidelines drifted`);
			assert.deepEqual(actual.parameters, expected.parameters, `${name} parameter schema drifted`);
		}
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_TOOL_CACHE;
		else process.env.PI_PRECOG_TOOL_CACHE = prev;
	}
});

test("precognition cached read fallback refuses absolute paths outside cwd", async () => {
	const { default: installPrecognition } = await import("../extensions/precognition.ts");
	const registeredTools = new Map();
	const handlers = new Map();
	const prev = process.env.PI_PRECOG_TOOL_CACHE;
	process.env.PI_PRECOG_TOOL_CACHE = "1";
	try {
		delete globalThis.__pi_precognition_loaded__;
		installPrecognition({
			registerTool(tool) {
				registeredTools.set(tool.name, tool);
			},
			on(name, handler) {
				handlers.set(name, handler);
			},
		});
		await handlers.get("session_start")?.({ type: "session_start" }, { hasUI: false, cwd: process.cwd() });

		await assert.rejects(
			() => registeredTools.get("read").execute("read-escape", { path: "/etc/hosts" }),
			/Refusing unsafe read path/,
		);
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_TOOL_CACHE;
		else process.env.PI_PRECOG_TOOL_CACHE = prev;
	}
});

test("precognition cached grep fallback refuses absolute paths outside cwd", async () => {
	const { default: installPrecognition } = await import("../extensions/precognition.ts");
	const registeredTools = new Map();
	const handlers = new Map();
	const prev = process.env.PI_PRECOG_TOOL_CACHE;
	process.env.PI_PRECOG_TOOL_CACHE = "1";
	try {
		delete globalThis.__pi_precognition_loaded__;
		installPrecognition({
			registerTool(tool) {
				registeredTools.set(tool.name, tool);
			},
			on(name, handler) {
				handlers.set(name, handler);
			},
		});
		await handlers.get("session_start")?.({ type: "session_start" }, { hasUI: false, cwd: process.cwd() });

		await assert.rejects(
			() => registeredTools.get("grep").execute("grep-escape", { pattern: "localhost", path: "/etc" }),
			/Refusing unsafe grep path/,
		);
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_TOOL_CACHE;
		else process.env.PI_PRECOG_TOOL_CACHE = prev;
	}
});

test("precognition session_start clears stale futures from prior cwd", async () => {
	const { default: installPrecognition } = await import("../extensions/precognition.ts");
	const fs = await import("node:fs/promises");
	const repoA = mkdtempSync(join(tmpdir(), "ultron-precog-session-a-"));
	const repoB = mkdtempSync(join(tmpdir(), "ultron-precog-session-b-"));
	await fs.mkdir(join(repoA, "src"), { recursive: true });
	await fs.mkdir(join(repoB, "src"), { recursive: true });
	await fs.writeFile(join(repoA, "src/a.ts"), "export const fromA = true;\n");
	await fs.writeFile(join(repoB, "src/b.ts"), "export const fromB = true;\n");
	const handlers = new Map();
	delete globalThis.__pi_precognition_loaded__;
	installPrecognition({
		registerTool() {},
		on(name, handler) {
			handlers.set(name, handler);
		},
	});

	await handlers.get("session_start")?.({ type: "session_start" }, { hasUI: false, cwd: repoA });
	await handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt: "read src/a.ts" });
	await handlers.get("session_start")?.({ type: "session_start" }, { hasUI: false, cwd: repoB });
	const result = await handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt: "read src/b.ts" });

	assert.doesNotMatch(String(result?.message?.content ?? ""), /fromA|src\/a\.ts/);
});

test("precognition chain futures warm local imports from an explicit file", async () => {
	const {
		analyzeDraft,
		createPrecogState,
		tryGhostToolCache,
		updateSnapshot,
		warmGhostTools,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-chain-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/app.ts"), "import { value } from './dep.ts';\nexport const app = value;\n");
	await fs.writeFile(join(dir, "src/dep.ts"), "export const value = 42;\n");

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/app.ts"],
		knownFiles: ["src/app.ts", "src/dep.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("debug src/app.ts", state.snapshot);
	await warmGhostTools(state, dir, evidence);

	const result = tryGhostToolCache(state, "read", { path: "src/dep.ts" });
	assert.equal(result?.details.precogCacheHit, true);
	assert.match(result.content[0].text, /value = 42/);
});

test("precognition command futures warm allowlisted npm test results when enabled", async () => {
	const {
		analyzeDraft,
		createPrecogState,
		tryGhostToolCache,
		updateSnapshot,
		warmGhostTools,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-command-"));
	await fs.writeFile(join(dir, "package.json"), JSON.stringify({
		type: "module",
		scripts: { test: "node test.js" },
	}, null, 2));
	await fs.writeFile(join(dir, "test.js"), "console.log('command future ok');\n");

	const prev = process.env.PI_PRECOG_COMMAND_FUTURES;
	process.env.PI_PRECOG_COMMAND_FUTURES = "1";
	try {
		const state = createPrecogState();
		updateSnapshot(state, {
			cwd: dir,
			changedFiles: ["test.js"],
			knownFiles: ["test.js", "package.json"],
			collectedAt: Date.now(),
			source: "git",
		});
		const evidence = analyzeDraft("run npm test for test.js", state.snapshot);
		await warmGhostTools(state, dir, evidence);

		const result = tryGhostToolCache(state, "bash", { command: "npm test" });
		assert.equal(result?.details.precogCacheHit, true);
		assert.match(result.content[0].text, /command future ok/);
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_COMMAND_FUTURES;
		else process.env.PI_PRECOG_COMMAND_FUTURES = prev;
	}
});

test("precognition command futures invalidate when causal repo files change", async () => {
	const {
		analyzeDraft,
		createPrecogState,
		tryGhostToolCache,
		updateSnapshot,
		warmGhostTools,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-command-stale-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "package.json"), JSON.stringify({
		type: "module",
		scripts: { test: "node test.js" },
	}, null, 2));
	await fs.writeFile(join(dir, "src/value.ts"), "export const value = 1;\n");
	await fs.writeFile(join(dir, "test.js"), "console.log('command future stale guard ok');\n");

	const prev = process.env.PI_PRECOG_COMMAND_FUTURES;
	process.env.PI_PRECOG_COMMAND_FUTURES = "1";
	try {
		const state = createPrecogState();
		updateSnapshot(state, {
			cwd: dir,
			changedFiles: ["test.js"],
			knownFiles: ["package.json", "src/value.ts", "test.js"],
			collectedAt: Date.now(),
			source: "git",
		});
		const evidence = analyzeDraft("run npm test for test.js", state.snapshot);
		await warmGhostTools(state, dir, evidence);

		const fresh = tryGhostToolCache(state, "bash", { command: "npm test" });
		assert.equal(fresh?.details.precogCacheHit, true);

		await new Promise((resolve) => setTimeout(resolve, 5));
		await fs.writeFile(join(dir, "src/value.ts"), "export const value = 2;\n");

		assert.equal(tryGhostToolCache(state, "bash", { command: "npm test" }), undefined);
		assert.equal(state.stats.toolCacheMisses, 1);
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_COMMAND_FUTURES;
		else process.env.PI_PRECOG_COMMAND_FUTURES = prev;
	}
});

test("precognition command futures can join an in-flight future instead of missing", async () => {
	const {
		analyzeDraft,
		createPrecogState,
		tryGhostToolCacheAsync,
		updateSnapshot,
		warmGhostTools,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-command-inflight-"));
	await fs.writeFile(join(dir, "package.json"), JSON.stringify({
		type: "module",
		scripts: { test: "node test.js" },
	}, null, 2));
	await fs.writeFile(join(dir, "test.js"), [
		"await new Promise((resolve) => setTimeout(resolve, 180));",
		"console.log('command future joined ok');",
	].join("\n"));

	const prevFutures = process.env.PI_PRECOG_COMMAND_FUTURES;
	const prevTimeout = process.env.PI_PRECOG_COMMAND_TIMEOUT_MS;
	process.env.PI_PRECOG_COMMAND_FUTURES = "1";
	process.env.PI_PRECOG_COMMAND_TIMEOUT_MS = "2000";
	try {
		const state = createPrecogState();
		updateSnapshot(state, {
			cwd: dir,
			changedFiles: ["test.js"],
			knownFiles: ["package.json", "test.js"],
			collectedAt: Date.now(),
			source: "git",
		});
		const evidence = analyzeDraft("run npm test for test.js", state.snapshot);
		const warming = warmGhostTools(state, dir, evidence);
		await new Promise((resolve) => setTimeout(resolve, 30));

		const result = await tryGhostToolCacheAsync(state, "bash", { command: "npm test" });
		await warming;

		assert.equal(result?.details.precogCacheHit, true);
		assert.match(result.content[0].text, /command future joined ok/);
		assert.equal(state.stats.toolCacheHits, 1);
		assert.equal(state.stats.toolCacheMisses, 0);
	} finally {
		if (prevFutures === undefined) delete process.env.PI_PRECOG_COMMAND_FUTURES;
		else process.env.PI_PRECOG_COMMAND_FUTURES = prevFutures;
		if (prevTimeout === undefined) delete process.env.PI_PRECOG_COMMAND_TIMEOUT_MS;
		else process.env.PI_PRECOG_COMMAND_TIMEOUT_MS = prevTimeout;
	}
});

test("precognition extension has a hard env off switch", async () => {
	const script = [
		"import install from './extensions/precognition.ts';",
		"const pi={tools:0,handlers:0,registerTool(){this.tools++},on(){this.handlers++}};",
		"install(pi);",
		"console.log(JSON.stringify({tools:pi.tools,handlers:pi.handlers}));",
	].join("");
	const { stdout } = await execFileAsync(process.execPath, ["-e", script], {
		cwd: new URL("..", import.meta.url),
		env: { ...process.env, PI_PRECOG: "0" },
	});
	assert.deepEqual(JSON.parse(stdout), { tools: 0, handlers: 0 });
});

test("precognition refuses path traversal and secret candidates", async () => {
	const {
		analyzeDraft,
		buildInjection,
		createPrecogState,
		updateSnapshot,
		warmReadOnlyEvidence,
	} = await import(MOD);
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-secret-"));
	await import("node:fs/promises").then(async (fs) => {
		await fs.writeFile(join(dir, ".env"), "SECRET=never\n");
		await fs.mkdir(join(dir, "src"), { recursive: true });
		await fs.writeFile(join(dir, "src/safe.ts"), "export const safe = true;\n");
	});
	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: [".env", "../outside.txt", "src/safe.ts"],
		knownFiles: [".env", "src/safe.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("fix .env and ../outside.txt and src/safe.ts", state.snapshot);
	await warmReadOnlyEvidence(state, dir, evidence);
	const injection = buildInjection(evidence, state.config, state.warmedFiles);

	assert.equal(state.warmedFiles.length, 1);
	assert.equal(state.warmedFiles[0].path, "src/safe.ts");
	assert.doesNotMatch(injection.content, /SECRET/);
});

test("precognition refuses symlink escapes even when the link is repo-local", async () => {
	const {
		analyzeDraft,
		buildInjection,
		createPrecogState,
		updateSnapshot,
		warmReadOnlyEvidence,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-symlink-"));
	const outside = mkdtempSync(join(tmpdir(), "ultron-precog-outside-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(outside, "loot.ts"), "export const SECRET_OUTSIDE_REPO = 'never';\n");
	await fs.symlink(join(outside, "loot.ts"), join(dir, "src", "loot.ts"));

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/loot.ts"],
		knownFiles: ["src/loot.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("fix src/loot.ts", state.snapshot);
	await warmReadOnlyEvidence(state, dir, evidence);
	const injection = buildInjection(evidence, state.config, state.warmedFiles);

	assert.equal(state.warmedFiles.length, 0);
	assert.doesNotMatch(String(injection?.content ?? ""), /SECRET_OUTSIDE_REPO/);
});

test("precognition refuses binary-looking warmed files", async () => {
	const {
		analyzeDraft,
		createPrecogState,
		updateSnapshot,
		warmReadOnlyEvidence,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-binary-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/blob.ts"), Buffer.from([0x65, 0x78, 0x00, 0xff, 0xfe, 0x00, 0x41]));

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/blob.ts"],
		knownFiles: ["src/blob.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("debug src/blob.ts", state.snapshot);
	await warmReadOnlyEvidence(state, dir, evidence);

	assert.equal(state.warmedFiles.length, 0);
});

test("precognition benchmark contract stays below one millisecond per submit-path injection", async () => {
	const {
		buildInjection,
		createPrecogState,
		observeDraft,
		updateSnapshot,
	} = await import(MOD);

	const changedFiles = Array.from({ length: 200 }, (_, i) => `src/module-${i}/widget-${i}.test.ts`);
	const state = createPrecogState();
	updateSnapshot(state, {
		changedFiles,
		knownFiles: changedFiles,
		collectedAt: Date.now(),
		source: "synthetic-git",
	});
	observeDraft(state, "fix failing widget-42.test.ts and review src/module-42/widget-42.test.ts", Date.now());

	const started = performance.now();
	for (let i = 0; i < 10_000; i += 1) buildInjection(state.evidence);
	const perCallMs = (performance.now() - started) / 10_000;

	assert.ok(perCallMs < 1, `submit-path injection too slow: ${perCallMs}ms`);
});

test("precognition debug log is optional and append-only", async () => {
	const { debugLog } = await import(MOD);
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-"));
	const file = join(dir, "precog.jsonl");
	const prev = process.env.PI_PRECOG_LOG;
	process.env.PI_PRECOG_LOG = file;
	try {
		await debugLog({ event: "test" });
		assert.equal(existsSync(file), true);
		const content = await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8"));
		assert.match(content, /"event":"test"/);
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_LOG;
		else process.env.PI_PRECOG_LOG = prev;
	}
});

test("precognition safely prewarms read-only file evidence before submit", async () => {
	const {
		analyzeDraft,
		buildInjection,
		createPrecogState,
		updateSnapshot,
		warmReadOnlyEvidence,
	} = await import(MOD);
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-repo-"));
	const srcDir = join(dir, "src");
	await import("node:fs/promises").then(async (fs) => {
		await fs.mkdir(srcDir, { recursive: true });
		await fs.writeFile(join(srcDir, "core.ts"), "export const answer = 42;\nexport function fixMe() { return answer; }\n");
		await fs.writeFile(join(dir, ".env"), "SECRET=nope\n");
	});
	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/core.ts", ".env"],
		knownFiles: ["src/core.ts", ".env"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("fix src/core.ts and check .env", state.snapshot);

	await warmReadOnlyEvidence(state, dir, evidence);
	const injection = buildInjection(evidence, state.config, state.warmedFiles);

	assert.match(injection.content, /warmed read-only evidence/);
	assert.match(injection.content, /src\/core\.ts/);
	assert.match(injection.content, /fixMe/);
	assert.doesNotMatch(injection.content, /SECRET/);
	assert.equal(state.stats.prefetches, 1);
});

test("precognition speculative warm path beats cold file read path by doing zero submit-time fs work", async () => {
	const {
		analyzeDraft,
		buildInjection,
		createPrecogState,
		updateSnapshot,
		warmReadOnlyEvidence,
	} = await import(MOD);
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-bench-"));
	await import("node:fs/promises").then(async (fs) => {
		await fs.mkdir(join(dir, "src"), { recursive: true });
		await fs.writeFile(join(dir, "src/big.ts"), Array.from({ length: 500 }, (_, i) => `export const v${i} = ${i};`).join("\n"));
	});
	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/big.ts"],
		knownFiles: ["src/big.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("debug src/big.ts latency", state.snapshot);
	await warmReadOnlyEvidence(state, dir, evidence);

	const started = performance.now();
	for (let i = 0; i < 5_000; i += 1) buildInjection(evidence, state.config, state.warmedFiles);
	const warmedSubmitMs = (performance.now() - started) / 5_000;

	assert.ok(warmedSubmitMs < 0.05, `warmed submit path too slow: ${warmedSubmitMs}ms`);
	assert.equal(state.warmedFiles.length, 1);
});

test("precognition warms ghost tool results without doing submit-time tool work", async () => {
	const {
		analyzeDraft,
		buildInjection,
		createPrecogState,
		updateSnapshot,
		warmGhostTools,
		warmReadOnlyEvidence,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-ghost-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/core.ts"), "export function hotPath() { return 42; }\n");
	await execFileAsync("git", ["init"], { cwd: dir });
	await execFileAsync("git", ["add", "src/core.ts"], { cwd: dir });
	await execFileAsync("git", ["commit", "-m", "seed"], {
		cwd: dir,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "tester",
			GIT_AUTHOR_EMAIL: "tester@example.test",
			GIT_COMMITTER_NAME: "tester",
			GIT_COMMITTER_EMAIL: "tester@example.test",
		},
	});
	await fs.writeFile(join(dir, "src/core.ts"), "export function hotPath() { return 43; }\n");

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/core.ts"],
		knownFiles: ["src/core.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("fix src/core.ts hotPath regression", state.snapshot);
	await warmReadOnlyEvidence(state, dir, evidence);
	await warmGhostTools(state, dir, evidence);
	const injection = buildInjection(evidence, state.config, state.warmedFiles, state.ghostTools);

	assert.ok(state.ghostTools.some((tool) => tool.name === "read" && tool.path === "src/core.ts"));
	assert.ok(state.ghostTools.some((tool) => tool.name === "git_status_short"));
	assert.ok(state.ghostTools.some((tool) => tool.name === "git_diff_name_only"));
	assert.match(injection.content, /ghost tool results/);
	assert.match(injection.content, /hotPath/);
	assert.match(injection.content, /src\/core\.ts/);
});

test("precognition cache-index injection mode keeps warmed content out of hidden context", async () => {
	const {
		analyzeDraft,
		buildInjection,
		createPrecogState,
		updateSnapshot,
		warmGhostTools,
		warmReadOnlyEvidence,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-cache-index-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/core.ts"), "export const privateButSafeContent = 42;\n");

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/core.ts"],
		knownFiles: ["src/core.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("read src/core.ts", state.snapshot);
	await warmReadOnlyEvidence(state, dir, evidence);
	await warmGhostTools(state, dir, evidence);

	const prev = process.env.PI_PRECOG_INJECTION_MODE;
	process.env.PI_PRECOG_INJECTION_MODE = "cache-index";
	try {
		const injection = buildInjection(evidence, state.config, state.warmedFiles, state.ghostTools);
		assert.match(injection.content, /Cache-index mode/);
		assert.match(injection.content, /src\/core\.ts/);
		assert.doesNotMatch(injection.content, /privateButSafeContent/);
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_INJECTION_MODE;
		else process.env.PI_PRECOG_INJECTION_MODE = prev;
	}
});

test("precognition verified-futures injection mode exposes receipts without warmed content", async () => {
	const {
		analyzeDraft,
		buildInjection,
		createPrecogState,
		updateSnapshot,
		warmGhostTools,
		warmReadOnlyEvidence,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-verified-futures-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/core.ts"), "export const futureSecretButSafe = 42;\n");

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/core.ts"],
		knownFiles: ["src/core.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("read src/core.ts", state.snapshot);
	await warmReadOnlyEvidence(state, dir, evidence);
	await warmGhostTools(state, dir, evidence);

	const prev = process.env.PI_PRECOG_INJECTION_MODE;
	process.env.PI_PRECOG_INJECTION_MODE = "verified-futures";
	try {
		const injection = buildInjection(evidence, state.config, state.warmedFiles, state.ghostTools);
		assert.match(injection.content, /Verified tool futures armed/);
		assert.match(injection.content, /read:src\/core\.ts/);
		assert.doesNotMatch(injection.content, /futureSecretButSafe/);
		assert.ok(injection.content.length < 260, `future receipt too large: ${injection.content.length}`);
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_INJECTION_MODE;
		else process.env.PI_PRECOG_INJECTION_MODE = prev;
	}
});

test("precognition silent-futures mode warms tool cache without injecting context", async () => {
	const {
		analyzeDraft,
		buildInjection,
		createPrecogState,
		tryGhostToolCache,
		updateSnapshot,
		warmGhostTools,
		warmReadOnlyEvidence,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-silent-futures-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/core.ts"), "export const silentFuture = 42;\n");

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/core.ts"],
		knownFiles: ["src/core.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("use the read tool on src/core.ts", state.snapshot);
	await warmReadOnlyEvidence(state, dir, evidence);
	await warmGhostTools(state, dir, evidence);

	const prev = process.env.PI_PRECOG_INJECTION_MODE;
	process.env.PI_PRECOG_INJECTION_MODE = "silent-futures";
	try {
		assert.equal(buildInjection(evidence, state.config, state.warmedFiles, state.ghostTools), undefined);
		const result = tryGhostToolCache(state, "read", { path: "src/core.ts" });
		assert.equal(result?.details.precogCacheHit, true);
		assert.match(result.content[0].text, /silentFuture/);
	} finally {
		if (prev === undefined) delete process.env.PI_PRECOG_INJECTION_MODE;
		else process.env.PI_PRECOG_INJECTION_MODE = prev;
	}
});

test("precognition ghost tools keep secret and symlink escape results out of context", async () => {
	const {
		analyzeDraft,
		buildInjection,
		createPrecogState,
		updateSnapshot,
		warmGhostTools,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-ghost-safe-"));
	const outside = mkdtempSync(join(tmpdir(), "ultron-precog-ghost-outside-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, ".env"), "SECRET_TOKEN=never\n");
	await fs.writeFile(join(outside, "loot.ts"), "export const OUTSIDE_SECRET = 'never';\n");
	await fs.symlink(join(outside, "loot.ts"), join(dir, "src", "loot.ts"));

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: [".env", "src/loot.ts"],
		knownFiles: [".env", "src/loot.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const evidence = analyzeDraft("inspect .env and src/loot.ts", state.snapshot);
	await warmGhostTools(state, dir, evidence);
	const injection = buildInjection(evidence, state.config, state.warmedFiles, state.ghostTools);

	assert.equal(state.ghostTools.filter((tool) => tool.name === "read").length, 0);
	assert.doesNotMatch(String(injection?.content ?? ""), /SECRET_TOKEN|OUTSIDE_SECRET/);
});

test("precognition ignores pasted screenshot timestamp fragments instead of crashing", async () => {
	const {
		analyzeDraft,
		createPrecogState,
		updateSnapshot,
		warmGhostTools,
	} = await import(MOD);
	const fs = await import("node:fs/promises");
	const dir = mkdtempSync(join(tmpdir(), "ultron-precog-screenshots-"));
	await fs.mkdir(join(dir, "src"), { recursive: true });
	await fs.writeFile(join(dir, "src/core.ts"), "export const ok = true;\n");

	const state = createPrecogState();
	updateSnapshot(state, {
		cwd: dir,
		changedFiles: ["src/core.ts"],
		knownFiles: ["src/core.ts"],
		collectedAt: Date.now(),
		source: "git",
	});
	const draft = [
		"/Users/test-user/Desktop/Screenshot\\ 2026-05-15\\ at\\ 10.34.21 AM.png",
		"/Users/test-user/Desktop/Screenshot\\ 2026-05-15\\ at\\ 10.34.17 AM.png",
		"/Users/test-user/Desktop/Screenshot\\ 2026-05-15\\ at\\ 10.34.13 AM.png",
		"please inspect these",
	].join(" ");
	const evidence = analyzeDraft(draft, state.snapshot);

	await assert.doesNotReject(() => warmGhostTools(state, dir, evidence));
	assert.equal(state.ghostTools.filter((tool) => tool.name === "read").length, 0);
});
