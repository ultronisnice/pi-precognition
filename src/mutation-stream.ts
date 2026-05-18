import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gitChangedFiles } from "./core.ts";

export interface MutationEvent {
	at: number;
	cwd: string;
	changed: string[];
	added: string[];
	removed: string[];
	modified: string[];
}

export interface MutationStream {
	cwd: string;
	lastChanged: string[];
	events: MutationEvent[];
}

export interface AnticipationVerdict {
	armed: string[];
	rejected: Array<[string, string]>;
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp)$/;
const EXPENSIVE = [
	{ key: "bash:npm test", script: "test" },
	{ key: "bash:npm run typecheck", script: "typecheck" },
	{ key: "bash:npm run lint", script: "lint" },
	{ key: "bash:npm run build", script: "build" },
] as const;

export function createMutationStream(cwd: string): MutationStream {
	return { cwd, lastChanged: [], events: [] };
}

export async function recordMutationSnapshot(stream: MutationStream, now = Date.now()): Promise<MutationEvent> {
	const fromGit = [...new Set(await gitChangedFiles(stream.cwd))];
	const changed = fromGit.length ? fromGit : await scanSourceFiles(stream.cwd);
	const previous = new Set(stream.lastChanged);
	const current = new Set(changed);
	const added = changed.filter((path) => !previous.has(path));
	const removed = stream.lastChanged.filter((path) => !current.has(path));
	const modified = changed.filter((path) => previous.has(path));
	const event = { at: now, cwd: stream.cwd, changed, added, removed, modified };
	stream.lastChanged = changed;
	stream.events.push(event);
	return event;
}

export async function evaluateExpensiveFutures(cwd: string, event: MutationEvent): Promise<AnticipationVerdict> {
	const scripts = await readPackageScripts(cwd);
	const sourceChanged = event.changed.some((path) => SOURCE_EXT.test(path));
	const armed: string[] = [];
	const rejected: Array<[string, string]> = [];
	const armedSet = new Set<string>();

	for (const candidate of EXPENSIVE) {
		if (!scripts[candidate.script]) { rejected.push([candidate.key, `no scripts.${candidate.script} in package.json`]); continue; }
		if (!sourceChanged) { rejected.push([candidate.key, "nothing to arm — no source changes since last snapshot"]); continue; }
		armed.push(candidate.key);
		armedSet.add(candidate.key);
	}

	// Library-driven extension: arm additional command futures the Pattern
	// Library has historical evidence for (hits or saved time), and that
	// overlap the current mutation footprint. This is the active-policy
	// hop that turns memory into anticipation.
	try {
		const { loadPatternLibrary } = await import("./pattern-library.ts");
		const library = await loadPatternLibrary(cwd);
		if (library.patterns?.length && (sourceChanged || event.changed.length > 0)) {
			const mutationSet = new Set(event.changed);
			const seen = new Set<string>(armedSet);
			const extras: Array<{ key: string; score: number; pattern: string }> = [];
			for (const pattern of library.patterns) {
				const overlap = pattern.refs.some((ref) => mutationSet.has(ref));
				const tagMatch = pattern.intentTags.some((t) => ["build", "test", "debug"].includes(t));
				if (!overlap && !tagMatch) continue;
				for (const future of pattern.futures) {
					if (!future.key.startsWith("bash:")) continue;
					if (seen.has(future.key)) continue;
					const paidOff = future.hits >= 1 || future.savedMs >= 250;
					const notRejected = future.rejections <= future.hits + 1;
					if (!paidOff || !notRejected) continue;
					extras.push({
						key: future.key,
						score: future.hits * 2 + future.savedMs / 1000 - future.rejections,
						pattern: pattern.label,
					});
				}
			}
			extras.sort((a, b) => b.score - a.score);
			for (const extra of extras.slice(0, 4)) {
				if (seen.has(extra.key)) continue;
				seen.add(extra.key);
				armed.push(`${extra.key} (library: ${extra.pattern})`);
			}
		}
	} catch {
		/* library unavailable — fall through with hardcoded armed set */
	}

	return { armed, rejected };
}

async function readPackageScripts(cwd: string): Promise<Record<string, string>> {
	try { return JSON.parse(await readFile(join(cwd, "package.json"), "utf8"))?.scripts ?? {}; } catch { return {}; }
}

async function scanSourceFiles(cwd: string): Promise<string[]> {
	if (existsSync(join(cwd, ".git"))) return [];
	const out: string[] = [];
	await walk(cwd, cwd, out, 0);
	return out;
}

async function walk(root: string, dir: string, out: string[], depth: number): Promise<void> {
	if (depth > 3 || out.length > 200) return;
	let entries: Array<{ name: string; isDir: boolean }>; 
	try { entries = (await readdir(dir, { withFileTypes: true })).map((e) => ({ name: e.name, isDir: e.isDirectory() })); }
	catch { return; }
	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const full = join(dir, entry.name);
		if (entry.isDir) { await walk(root, full, out, depth + 1); continue; }
		if (SOURCE_EXT.test(entry.name)) out.push(full.slice(root.length + 1));
	}
}
