import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { GhostToolResult, PrecogEvidence, PrecogState } from "./core.ts";
import { composeFutures } from "./future-compose.ts";

export interface PatternFutureStats {
	key: string;
	armed: number;
	hits: number;
	misses: number;
	rejections: number;
	savedMs: number;
	lastReason?: string;
	lastSeenAt: number;
}

export interface PatternRecord {
	id: string;
	label: string;
	project: string;
	refs: string[];
	intentTags: string[];
	count: number;
	confidence: number;
	futures: PatternFutureStats[];
	createdAt: number;
	updatedAt: number;
}

export interface PatternLibraryFile {
	version: 1;
	project: string;
	updatedAt: number;
	patterns: PatternRecord[];
	events: Array<{ at: number; type: string; message: string; details?: Record<string, unknown> }>;
}

export interface PatternObservation {
	evidence?: PrecogEvidence;
	ghostTools?: GhostToolResult[];
	project?: string;
	reason?: string;
	now?: number;
}

export function patternStorePath(cwd: string): string {
	return resolve(cwd, ".pi-precognition", "patterns.json");
}

export async function loadPatternLibrary(cwd: string): Promise<PatternLibraryFile> {
	const file = patternStorePath(cwd);
	try {
		const parsed = JSON.parse(await readFile(file, "utf8"));
		if (parsed?.version === 1 && Array.isArray(parsed.patterns)) return parsed;
	} catch {}
	return { version: 1, project: projectId(cwd), updatedAt: Date.now(), patterns: [], events: [] };
}

export async function savePatternLibrary(cwd: string, library: PatternLibraryFile): Promise<void> {
	const file = patternStorePath(cwd);
	await mkdir(dirname(file), { recursive: true });
	library.updatedAt = Date.now();
	library.patterns.sort((a, b) => scorePattern(b) - scorePattern(a));
	library.patterns = library.patterns.slice(0, 200);
	library.events = library.events.slice(-500);
	await writeFile(file, `${JSON.stringify(library, null, 2)}\n`);
}

export async function observePattern(cwd: string, observation: PatternObservation): Promise<PatternLibraryFile> {
	const library = await loadPatternLibrary(cwd);
	const now = observation.now ?? Date.now();
	const evidence = observation.evidence;
	const refs = [...new Set([...(evidence?.refs ?? []), ...(evidence?.changed ?? [])])].slice(0, 8);
	const intentTags = [...new Set(evidence?.intentTags ?? [])].slice(0, 6);
	const label = labelFor(intentTags, refs);
	const id = hash([label, ...refs.slice(0, 3), ...intentTags].join("|"));
	let record = library.patterns.find((p) => p.id === id);
	if (!record) {
		record = { id, label, project: library.project, refs, intentTags, count: 0, confidence: evidence?.confidence ?? 0.25, futures: [], createdAt: now, updatedAt: now };
		library.patterns.push(record);
	}
	record.count += 1;
	record.updatedAt = now;
	record.refs = [...new Set([...refs, ...record.refs])].slice(0, 8);
	record.intentTags = [...new Set([...intentTags, ...record.intentTags])].slice(0, 6);
	record.confidence = Math.max(record.confidence, evidence?.confidence ?? 0.25);
	for (const composed of composeFutures(evidence)) {
		let stat = record.futures.find((f) => f.key === composed.key);
		if (!stat) {
			stat = { key: composed.key, armed: 0, hits: 0, misses: 0, rejections: 0, savedMs: 0, lastSeenAt: now };
			record.futures.push(stat);
		}
		stat.armed += 1;
		stat.lastSeenAt = now;
	}
	for (const tool of observation.ghostTools ?? []) {
		const key = tool.key;
		let stat = record.futures.find((f) => f.key === key);
		if (!stat) {
			stat = { key, armed: 0, hits: 0, misses: 0, rejections: 0, savedMs: 0, lastSeenAt: now };
			record.futures.push(stat);
		}
		stat.armed += 1;
		stat.lastSeenAt = now;
	}
	library.events.push({ at: now, type: "pattern_observed", message: `${label} observed`, details: { refs, intentTags, futures: (observation.ghostTools ?? []).map((t) => t.key) } });
	await savePatternLibrary(cwd, library);
	return library;
}

export async function recordFutureOutcome(cwd: string, key: string, outcome: "hit" | "miss" | "rejected", opts: { savedMs?: number; reason?: string; now?: number } = {}): Promise<void> {
	const library = await loadPatternLibrary(cwd);
	const now = opts.now ?? Date.now();
	for (const pattern of library.patterns) {
		const stat = pattern.futures.find((f) => f.key === key);
		if (!stat) continue;
		if (outcome === "hit") stat.hits += 1;
		if (outcome === "miss") stat.misses += 1;
		if (outcome === "rejected") stat.rejections += 1;
		stat.savedMs += opts.savedMs ?? 0;
		stat.lastReason = opts.reason;
		stat.lastSeenAt = now;
		pattern.updatedAt = now;
	}
	library.events.push({ at: now, type: `future_${outcome}`, message: `${key} ${outcome}`, details: { savedMs: opts.savedMs ?? 0, reason: opts.reason } });
	await savePatternLibrary(cwd, library);
}

export function buildVisiblePatternLibrary(state: PrecogState, persisted?: PatternLibraryFile) {
	const live = state.evidence ? [{
		id: "live",
		label: labelFor(state.evidence.intentTags, [...state.evidence.refs, ...state.evidence.changed]),
		count: Math.max(1, state.stats.analyzed),
		confidence: state.evidence.confidence,
		refs: [...new Set([...state.evidence.refs, ...state.evidence.changed])],
		intentTags: state.evidence.intentTags,
		futures: state.ghostTools.map((tool) => ({ key: tool.key, armed: 1, hits: 0, misses: 0, rejections: 0, savedMs: 0, lastSeenAt: tool.collectedAt })),
	}] : [];
	const patterns = [...(persisted?.patterns ?? []), ...live]
		.sort((a: any, b: any) => scorePattern(b) - scorePattern(a))
		.slice(0, 20);
	return { generatedAt: Date.now(), project: persisted?.project ?? state.snapshot.cwd, patterns, recentEvents: persisted?.events?.slice(-20) ?? [] };
}

export function renderPatternLibrary(library: ReturnType<typeof buildVisiblePatternLibrary>): string {
	const totals = sumFutureStats(library.patterns.flatMap((p: any) => p.futures ?? []));
	const lines = [
		`Pattern Library · ${library.patterns.length} patterns · ${library.project}`,
		`  totals: ${totals.hits} hits / ${totals.armed} armed · saved ${formatMs(totals.saved)}`,
	];
	for (const pattern of library.patterns) {
		const s = sumFutureStats(pattern.futures);
		const denom = Math.max(s.armed, s.hits);
		const hitRate = denom > 0 && s.hits > 0 ? ` · hit-rate ${Math.min(100, (s.hits / denom) * 100).toFixed(0)}% (${s.hits} of ${denom} hits)` : "";
		const futures = pattern.futures.slice(0, 4).map((f: any) => `${f.key} a${f.armed}/h${f.hits}/r${f.rejections}`).join(", ") || "none";
		lines.push(`- ${pattern.label} · count ${pattern.count} · conf ${pattern.confidence.toFixed(2)} · saved ${formatMs(s.saved)}${hitRate} · ${futures}`);
		if (pattern.refs.length) lines.push(`  refs: ${pattern.refs.slice(0, 5).join(", ")}`);
	}
	return lines.join("\n");
}

function labelFor(intentTags: string[], refs: string[]): string {
	if (intentTags.includes("test")) return "test-after-edit";
	if (intentTags.includes("build")) return "build/typecheck-preflight";
	if (intentTags.includes("review")) return "review-read-first";
	if (refs.length) return "path-read-preflight";
	return "operator-rhythm";
}

function scorePattern(pattern: { count: number; confidence: number; futures?: PatternFutureStats[] }): number {
	const futures = pattern.futures ?? [];
	const saved = futures.reduce((sum, f) => sum + f.savedMs, 0);
	const hits = futures.reduce((sum, f) => sum + f.hits, 0);
	const rejections = futures.reduce((sum, f) => sum + f.rejections, 0);
	return pattern.count * pattern.confidence + hits * 2 + saved / 1000 - rejections;
}

function projectId(cwd: string): string {
	return existsSync(join(cwd, ".git")) ? resolve(cwd).split(/[\\/]/).pop() ?? resolve(cwd) : resolve(cwd);
}

function hash(text: string): string {
	return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function formatMs(ms: number): string {
	if (Math.abs(ms) < 1000) return `${ms.toFixed(0)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function sumFutureStats(futures: any[]): { armed: number; hits: number; saved: number } {
	return (futures ?? []).reduce(
		(acc: any, f: any) => ({ armed: acc.armed + (f.armed ?? 0), hits: acc.hits + (f.hits ?? 0), saved: acc.saved + (f.savedMs ?? 0) }),
		{ armed: 0, hits: 0, saved: 0 },
	);
}
