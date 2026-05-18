#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { cacheDelayMs } from "./cache-delay.ts";
import { createMutationStream, recordMutationSnapshot, evaluateExpensiveFutures } from "./mutation-stream.ts";
import { buildVisiblePatternLibrary, loadPatternLibrary, observePattern, renderPatternLibrary } from "./pattern-library.ts";
import { createPrecogState, ensureCommandGhost, refreshGitSnapshot, snapshotStats, tryGhostToolCacheAsync, warmGhostTools, warmReadOnlyEvidence, listCommandClasses, observeDraft } from "./core.ts";

const execFileAsync = promisify(execFile);
const VERSION = "0.3.0";

type CliOptions = Record<string, string | boolean | undefined>;

async function main(argv = process.argv.slice(2)): Promise<void> {
	const command = argv[0] ?? "help";
	const { options } = parseArgs(argv.slice(1));
	if (["help", "--help", "-h"].includes(command)) return printHelp();
	if (["version", "--version"].includes(command)) return console.log(VERSION);
	if (command === "doctor") return doctor(options);
	if (command === "patterns") return patterns(options);
	if (command === "watch") return watch(options);
	if (command === "bench") return bench(options);
	throw new Error(`Unknown command: ${command}`);
}

function printHelp(): void {
	console.log(`pi-precognition ${VERSION}\n\nUsage:\n  pi-precognition doctor [--cwd path]\n  pi-precognition patterns [--live] [--cwd path]\n  pi-precognition watch [--once] [--interval 1000] [--cwd path]\n  pi-precognition bench --paired --workload all --iterations 10 --out validation\n\nPredict the wait, not the answer. Learn the operator rhythm.`);
}

async function doctor(options: CliOptions): Promise<void> {
	const cwd = resolve(String(options.cwd ?? process.cwd()));
	const state = createPrecogState();
	await refreshGitSnapshot(state, cwd).catch(() => undefined);
	const library = await loadPatternLibrary(cwd);
	const stats = snapshotStats(state);
	const checks = [
		["package", true, `pi-precognition ${VERSION}`],
		["cwd", existsSync(cwd), cwd],
		["git snapshot", stats.snapshot.knownFiles > 0 || stats.snapshot.changedFiles > 0, `${stats.snapshot.knownFiles} known / ${stats.snapshot.changedFiles} changed`],
		["command classes", true, `${listCommandClasses().length} classes`],
		["pattern library", true, `${library.patterns.length} persisted patterns`],
		["command futures", commandFuturesEnabled(), commandFuturesEnabled() ? "enabled" : "disabled (set PI_PRECOG_COMMAND_FUTURES=1)"],
		["tool cache", toolCacheEnabled(), toolCacheEnabled() ? "enabled" : "disabled (set PI_PRECOG_TOOL_CACHE=1)"],
	];
	for (const [name, ok, detail] of checks) console.log(`${ok ? "✅" : "⚠️ "} ${name}: ${detail}`);
}

async function patterns(options: CliOptions): Promise<void> {
	const cwd = resolve(String(options.cwd ?? process.cwd()));
	const state = createPrecogState();
	await refreshGitSnapshot(state, cwd).catch(() => undefined);
	const persisted = await loadPatternLibrary(cwd);
	console.log(renderPatternLibrary(buildVisiblePatternLibrary(state, persisted)));
	if (options.live) {
		console.log("\nLive view · Ctrl+C to stop");
		await watch({ ...options, cwd, interval: options.interval ?? "1500" });
	}
}

async function watch(options: CliOptions): Promise<void> {
	const cwd = resolve(String(options.cwd ?? process.cwd()));
	const stream = createMutationStream(cwd);
	const interval = Math.max(250, Number(options.interval ?? 1000));
	const tick = async () => {
		const event = await recordMutationSnapshot(stream);
		const library = await loadPatternLibrary(cwd);
		const top = library.patterns[0];
		const topFuture = top?.futures?.[0];
		const verdict = await evaluateExpensiveFutures(cwd, event);
		const baseLine = `${new Date(event.at).toLocaleTimeString()} · mutation#${stream.events.length} changed=${event.changed.length} +${event.added.length}/-${event.removed.length} ~${event.modified.length} · top=${top?.label ?? "none"} · armed=${topFuture?.key ?? "none"} · saved=${Math.round(topFuture?.savedMs ?? 0)}ms`;
		console.log(baseLine);
		console.log(`  armed: ${verdict.armed.join(", ") || "none"}`);
		for (const [key, reason] of verdict.rejected) console.log(`  rejected: ${key} — ${reason}`);
	};
	await tick();
	if (options.once) return;
	setInterval(() => void tick(), interval);
}

async function bench(options: CliOptions): Promise<void> {
	const cwd = resolve(String(options.cwd ?? process.cwd()));
	const selected = await selectWorkloads(String(options.workload ?? "all"), cwd);
	const iterations = Math.max(1, Number(options.iterations ?? 10));
	const paired = Boolean(options.paired);
	const outDir = resolve(String(options.out ?? "validation"));
	await mkdir(outDir, { recursive: true });
	const run = { generatedAt: new Date().toISOString(), version: VERSION, cwd, paired, iterations, workloads: [] as any[] };
	for (const workload of selected) {
		const samples = [] as any[];
		for (let i = 0; i < iterations; i += 1) {
			const off = await measureCold(cwd, workload);
			const on = paired ? await measureWarm(cwd, workload) : undefined;
			samples.push({ iteration: i + 1, off, on });
		}
		run.workloads.push({ name: workload.name, future: workload.future, samples, summary: summarize(samples) });
	}
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const prefix = paired ? "live-paired" : "bench";
	const jsonPath = resolve(outDir, `${prefix}-${stamp}.json`);
	const mdPath = resolve(outDir, `${prefix}-${stamp}.md`);
	await writeFile(jsonPath, `${JSON.stringify(run, null, 2)}\n`);
	await writeFile(mdPath, renderBenchMarkdown(run, jsonPath));
	console.log(`wrote ${relative(process.cwd(), mdPath)}`);
	console.log(renderBenchSummary(run));
}

function workloads() {
	return [
		{ name: "slow-command", draft: "fix the failing tests and run npm test", future: { tool: "bash", command: "npm test", classKey: "bash:npm test" } },
		{ name: "typecheck", draft: "update TypeScript and run typecheck", future: { tool: "bash", command: "npm run typecheck", classKey: "bash:npm typecheck" } },
		{ name: "lint", draft: "clean lint issues and run npm lint", future: { tool: "bash", command: "npm run lint", classKey: "bash:npm lint" } },
	];
}

async function selectWorkloads(name: string, cwd: string) {
	let selected = name === "all"
		? workloads()
		: name.split(",").flatMap((part) => {
			const key = part.trim();
			const aliases: Record<string, string> = { test: "slow-command" };
			const wanted = aliases[key] ?? key;
			const hit = workloads().find((w) => w.name === wanted);
			if (!hit) throw new Error(`Unknown workload: ${key}`);
			return [hit];
		});
	const pkg = await readPackageJson(cwd);
	selected = selected.filter((workload) => {
		if (workload.future.command === "npm test") return Boolean(pkg?.scripts?.test);
		if (workload.future.command === "npm run typecheck") return Boolean(pkg?.scripts?.typecheck);
		if (workload.future.command === "npm run lint") return Boolean(pkg?.scripts?.lint);
		return true;
	});
	if (!selected.length) throw new Error(`No requested workloads are available in package.json scripts for ${cwd}`);
	return selected;
}

async function measureCold(cwd: string, workload: any) {
	const start = performance.now();
	await executeFutureDirect(cwd, workload.future);
	return { firstWaitMs: Number((performance.now() - start).toFixed(3)) };
}

async function measureWarm(cwd: string, workload: any) {
	const state = createPrecogState();
	const warmStart = performance.now();
	await refreshGitSnapshot(state, cwd).catch(() => undefined);
	const evidence = observeDraft(state, workload.draft);
	await Promise.allSettled([warmReadOnlyEvidence(state, cwd, evidence), warmGhostTools(state, cwd, evidence)]);
	if (commandFuturesEnabled() && workload.future.classKey) {
		const commandFuture = await ensureCommandGhost(state, cwd, workload.future.classKey);
		if (commandFuture && !state.ghostTools.some((tool) => tool.key === commandFuture.key)) state.ghostTools.push(commandFuture);
	}
	await observePattern(cwd, { evidence, ghostTools: state.ghostTools });
	const warmMs = Number((performance.now() - warmStart).toFixed(3));
	const commitStart = performance.now();
	const hit = await tryGhostToolCacheAsync(state, "bash", { command: workload.future.command });
	let cacheHit = Boolean(hit);
	if (cacheHit) await sleep(cacheDelayMs("bash"));
	else await executeFutureDirect(cwd, workload.future);
	const commitWaitMs = Number((performance.now() - commitStart).toFixed(3));
	return { commitWaitMs, warmMs, cacheHit, stats: snapshotStats(state) };
}

async function readPackageJson(cwd: string): Promise<any | undefined> {
	try { return JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8")); } catch { return undefined; }
}

async function executeFutureDirect(cwd: string, future: any): Promise<void> {
	if (future.command === "npm test") await execFileAsync("npm", ["test"], { cwd, timeout: 30_000, maxBuffer: 256 * 1024, env: { ...process.env, NO_COLOR: "1" } });
	else if (future.command === "npm run typecheck") await execFileAsync("npm", ["run", "typecheck"], { cwd, timeout: 30_000, maxBuffer: 256 * 1024, env: { ...process.env, NO_COLOR: "1" } });
	else if (future.command === "npm run lint") await execFileAsync("npm", ["run", "lint"], { cwd, timeout: 30_000, maxBuffer: 256 * 1024, env: { ...process.env, NO_COLOR: "1" } });
}

function summarize(samples: any[]) {
	const off = samples.map((s) => s.off.firstWaitMs);
	const on = samples.map((s) => s.on?.commitWaitMs).filter((n) => typeof n === "number");
	const warm = samples.map((s) => s.on?.warmMs).filter((n) => typeof n === "number");
	const hits = samples.filter((s) => s.on?.cacheHit).length;
	return { offAvgMs: avg(off), onAvgMs: avg(on), warmAvgMs: avg(warm), deltaMs: on.length ? Number((avg(off)! - avg(on)!).toFixed(3)) : undefined, cacheHits: hits, samples: samples.length };
}

function sleep(ms: number): Promise<void> { return ms <= 0 ? Promise.resolve() : new Promise((resolveFn) => setTimeout(resolveFn, ms)); }
function avg(values: number[]): number | undefined { return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)) : undefined; }
function renderBenchSummary(run: any): string { return run.workloads.map((w: any) => `${w.name}: first-wait=${w.summary.offAvgMs}ms precog-commit=${w.summary.onAvgMs}ms saved=${w.summary.deltaMs}ms cache=${w.summary.cacheHits}/${w.summary.samples}`).join("\n"); }
function renderBenchMarkdown(run: any, jsonPath: string): string {
	const rows = run.workloads.map((w: any) => `| ${w.name} | ${w.summary.offAvgMs} | ${w.summary.onAvgMs} | ${w.summary.deltaMs} | ${w.summary.warmAvgMs} | ${w.summary.cacheHits}/${w.summary.samples} |`).join("\n");
	return `# pi-precognition v0.3 live-paired benchmark\n\nGenerated: ${run.generatedAt}\nVersion: ${run.version}\nCWD: ${run.cwd}\nPaired: ${run.paired}\nIterations: ${run.iterations}\nJSON: ${jsonPath}\n\n| workload | first wait without precog avg ms | post-warm commit wait avg ms | saved ms | operator-time warm cost ms | cache hits |\n|---|---:|---:|---:|---:|---:|\n${rows}\n\nInterpretation: saved ms compares normal first tool wait against post-warm commit wait. Warm cost is paid during operator drafting time and shown separately.\n`;
}
function parseArgs(args: string[]): { options: CliOptions } {
	const options: CliOptions = {};
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const next = args[i + 1];
		if (!next || next.startsWith("--")) options[key] = true;
		else { options[key] = next; i += 1; }
	}
	return { options };
}
function commandFuturesEnabled(): boolean { return process.env.PI_PRECOG_COMMAND_FUTURES === "1" || process.env.PI_PRECOG_COMMAND_FUTURES === "true"; }
function toolCacheEnabled(): boolean { return process.env.PI_PRECOG_TOOL_CACHE === "1" || process.env.PI_PRECOG_TOOL_CACHE === "true"; }

main().catch((err) => { console.error(err?.stack || err?.message || String(err)); process.exit(1); });
