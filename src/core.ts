import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { readFile, realpath, readdir, stat } from "node:fs/promises";
import { appendFile } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PrecogConfig {
	maxRefs: number;
	maxChanged: number;
	maxIntentTags: number;
	maxEvidenceChars: number;
	maxInjectionChars: number;
	ttlMs: number;
}

export interface PrecogSnapshot {
	cwd: string;
	changedFiles: string[];
	knownFiles: string[];
	collectedAt: number;
	source: string;
}

export interface PrecogEvidence {
	draftHash: string;
	createdAt: number;
	refs: string[];
	changed: string[];
	intentTags: string[];
	observations: string[];
	summary: string;
	confidence: number;
	snapshotAgeMs?: number;
	source: string;
}

export interface WarmedFileEvidence {
	path: string;
	bytes: number;
	excerpt: string;
	collectedAt: number;
}

export interface GhostToolResult {
	name: "read" | "git_status_short" | "git_diff_name_only" | "rg_literal" | "bash_command";
	key: string;
	args: string[];
	path?: string;
	content: string;
	bytes: number;
	collectedAt: number;
	fileMtimeMs?: number;
	fileSize?: number;
	causalFiles?: Array<{ path: string; mtimeMs: number; size: number; sha1: string }>;
	/**
	 * Phase 2: chain depth at which this future was warmed.
	 * 1 = warmed from an explicit draft reference (or first-tool match).
	 * 2 = warmed by following local imports of a depth-1 file.
	 * Higher depths reserved for pi-cascade's intra-turn speculation.
	 */
	chainDepth?: number;
}

export interface PrecogState {
	config: PrecogConfig;
	lastDraft: string;
	snapshot: PrecogSnapshot;
	evidence?: PrecogEvidence;
	warmedFiles: WarmedFileEvidence[];
	ghostTools: GhostToolResult[];
	pendingGhostTools: Map<string, Promise<GhostToolResult | undefined>>;
	stats: {
		draftsSeen: number;
		analyzed: number;
		duplicateDrafts: number;
		cacheHits: number;
		totalAnalyzeMs: number;
		lastAnalyzeMs: number;
		maxAnalyzeMs: number;
		lastInjectionChars: number;
		snapshotRefreshes: number;
		prefetches: number;
		lastPrefetchMs: number;
		maxPrefetchMs: number;
		ghostToolWarms: number;
		lastGhostToolMs: number;
		maxGhostToolMs: number;
		toolCacheHits: number;
		toolCacheMisses: number;
	};
}

export const DEFAULT_PRECOG_CONFIG: PrecogConfig = Object.freeze({
	maxRefs: 8,
	maxChanged: 8,
	maxIntentTags: 6,
	maxEvidenceChars: 720,
	maxInjectionChars: 1_200,
	ttlMs: 30_000,
});

const MAX_WARMED_FILES = Number(process.env.PI_PRECOG_MAX_WARMED_FILES ?? 3);
const MAX_GHOST_TOOLS = Number(process.env.PI_PRECOG_MAX_GHOST_TOOLS ?? 6);
const MAX_WARM_FILE_BYTES = Number(process.env.PI_PRECOG_MAX_FILE_BYTES ?? 24_000);
const MAX_WARM_EXCERPT_CHARS = Number(process.env.PI_PRECOG_MAX_WARMED_CHARS ?? 2_400);
const MAX_GHOST_RESULT_CHARS = Number(process.env.PI_PRECOG_MAX_GHOST_CHARS ?? 2_400);
const GHOST_TOOL_TIMEOUT_MS = Number(process.env.PI_PRECOG_GHOST_TOOL_TIMEOUT_MS ?? 120);
const SECRET_PATH_RE = /(^|\/)(\.env($|[./])|\.npmrc$|\.netrc$|\.pypirc$|.*\.(?:pem|key|p12|pfx)$|auth\.json$|models\.json$|credentials?(?:\.[^.\/]+)?$|secrets?\/|\.ssh\/|\.aws\/|\.kube\/|\.docker\/config\.json$|\.config\/gh\/hosts\.yml$)/i;

const COMMAND_TAGS: ReadonlyArray<readonly [string, RegExp]> = Object.freeze([
	["test", /\b(test|tests|spec|failing|vitest|jest|playwright|pytest|unit|e2e)\b/i],
	["build", /\b(build|compile|tsc|bundle|lint|typecheck)\b/i],
	["debug", /\b(debug|trace|crash|stack|error|regression|bug|fix)\b/i],
	["review", /\b(review|audit|diff|pr|risk|regression)\b/i],
	["perf", /\b(perf|speed|latency|slow|benchmark|p95|p50)\b/i],
	["docs", /\b(readme|docs|document|paper|arxiv|writeup)\b/i],
]);

/**
 * COMMAND_CLASSES: the universal bash cache registry.
 *
 * Each class declares:
 *   - canonical cache key (e.g. "bash:npm test")
 *   - one or more bash-command regex patterns the model might emit
 *   - the intent tag(s) that should trigger draft-time warming
 *   - argv form for execFile to actually run the command
 *   - causal path filter — which repo files invalidate the future
 *
 * isFingerprinted=false means the future is short-TTL with no causal hash;
 * it relies on a fresh re-run for re-validation (used for fast read-only
 * git status/diff/log probes).
 */
interface CommandClass {
	key: string;
	label: string;
	patterns: RegExp[];
	intentTags: string[];
	runArgv: [string, string[]];
	timeoutMs?: number;
	isFingerprinted: boolean;
	causalFilter?: (paths: string[]) => string[];
	precondition?: (cwd: string, packageText: string | undefined) => boolean;
}

const NPM_TEST_CAUSAL = (paths: string[]): string[] => paths.filter((p) =>
	/^(package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|src\/.*|test\/.*|tests\/.*|__tests__\/.*|test\.[cm]?[jt]s|.*\.(?:test|spec)\.[cm]?[jt]sx?)$/i.test(p),
);
const TYPECHECK_CAUSAL = (paths: string[]): string[] => paths.filter((p) =>
	/^(package(?:-lock)?\.json|tsconfig(?:\.[^./]+)?\.json|.*\.(ts|tsx|d\.ts|cts|mts)$)/i.test(p),
);
const LINT_CAUSAL = (paths: string[]): string[] => paths.filter((p) =>
	/^(package(?:-lock)?\.json|\.eslintrc(?:\.[^./]+)?|eslint\.config\.[cm]?js|biome\.json|\.prettierrc(?:\.[^./]+)?|src\/.*|test\/.*|tests\/.*)$/i.test(p)
	&& /\.(ts|tsx|js|jsx|mjs|cjs|json|md)$|^(\.eslintrc|eslint\.config|biome\.json|\.prettierrc|package(?:-lock)?\.json|tsconfig)/.test(p),
);
const PYTEST_CAUSAL = (paths: string[]): string[] => paths.filter((p) =>
	/^(pyproject\.toml|setup\.cfg|pytest\.ini|conftest\.py|tox\.ini|.*\.py)$/i.test(p),
);
const BUILD_CAUSAL = (paths: string[]): string[] => paths.filter((p) =>
	/^(package(?:-lock)?\.json|tsconfig(?:\.[^./]+)?\.json|vite\.config\.[cm]?[jt]s|rollup\.config\.[cm]?[jt]s|esbuild\.config\.[cm]?[jt]s|webpack\.config\.[cm]?[jt]s|src\/.*)$/i.test(p),
);

const COMMAND_CLASSES: ReadonlyArray<CommandClass> = Object.freeze([
	{
		key: "bash:npm test",
		label: "npm test",
		patterns: [
			/^npm (?:run )?test(?: --(?: --silent|silent))?$/,
			/^npm (?:run )?test 2>&1 \| tail -\d+$/,
		],
		intentTags: ["test"],
		runArgv: ["npm", ["test", "--", "--silent"]],
		isFingerprinted: true,
		causalFilter: NPM_TEST_CAUSAL,
		precondition: (_cwd, pkg) => Boolean(pkg && /"test"\s*:/.test(pkg)),
	},
	{
		key: "bash:npm typecheck",
		label: "npm run typecheck",
		patterns: [
			/^npm (?:run )?(?:typecheck|tsc)(?: --(?: --silent|silent))?$/,
			/^tsc(?: -p [^\s]+)?(?: --noEmit)?$/,
			/^npx tsc(?: -p [^\s]+)?(?: --noEmit)?$/,
		],
		intentTags: ["build"],
		runArgv: ["npm", ["run", "typecheck", "--silent"]],
		isFingerprinted: true,
		causalFilter: TYPECHECK_CAUSAL,
		precondition: (_cwd, pkg) => Boolean(pkg && /"typecheck"\s*:/.test(pkg)),
	},
	{
		key: "bash:npm lint",
		label: "npm run lint",
		patterns: [
			/^npm (?:run )?lint(?: --(?: --silent|silent))?$/,
			/^npx eslint \.$/,
			/^npx eslint src$/,
		],
		intentTags: ["build"],
		runArgv: ["npm", ["run", "lint", "--silent"]],
		isFingerprinted: true,
		causalFilter: LINT_CAUSAL,
		precondition: (_cwd, pkg) => Boolean(pkg && /"lint"\s*:/.test(pkg)),
	},
	{
		key: "bash:vitest",
		label: "vitest run",
		patterns: [
			/^npx vitest(?: run)?$/,
			/^npm (?:run )?test:vitest$/,
			/^vitest(?: run)?$/,
		],
		intentTags: ["test"],
		runArgv: ["npx", ["vitest", "run", "--reporter=basic"]],
		isFingerprinted: true,
		causalFilter: NPM_TEST_CAUSAL,
		precondition: (_cwd, pkg) => Boolean(pkg && /"vitest"\s*:/.test(pkg)),
	},
	{
		key: "bash:jest",
		label: "jest",
		patterns: [/^npx jest$/, /^jest$/, /^npm (?:run )?test:jest$/],
		intentTags: ["test"],
		runArgv: ["npx", ["jest", "--silent"]],
		isFingerprinted: true,
		causalFilter: NPM_TEST_CAUSAL,
		precondition: (_cwd, pkg) => Boolean(pkg && /"jest"\s*:/.test(pkg)),
	},
	{
		key: "bash:pytest",
		label: "pytest -q",
		patterns: [/^pytest(?: -q)?$/, /^python -m pytest(?: -q)?$/],
		intentTags: ["test"],
		runArgv: ["pytest", ["-q"]],
		isFingerprinted: true,
		causalFilter: PYTEST_CAUSAL,
	},
	{
		key: "bash:npm build",
		label: "npm run build",
		patterns: [/^npm (?:run )?build(?: --(?: --silent|silent))?$/, /^npx tsc -b$/],
		intentTags: ["build"],
		runArgv: ["npm", ["run", "build", "--silent"]],
		isFingerprinted: true,
		causalFilter: BUILD_CAUSAL,
		precondition: (_cwd, pkg) => Boolean(pkg && /"build"\s*:/.test(pkg)),
	},
	{
		// Fast read-only git probes: no causal fingerprint, short TTL.
		key: "bash:git status",
		label: "git status",
		patterns: [/^git status$/, /^git status --short$/, /^git status -s$/],
		intentTags: ["review", "debug"],
		runArgv: ["git", ["status", "--short"]],
		isFingerprinted: false,
		timeoutMs: 800,
	},
	{
		key: "bash:git diff",
		label: "git diff",
		patterns: [/^git diff$/, /^git diff --name-only$/, /^git diff --stat$/],
		intentTags: ["review", "debug"],
		runArgv: ["git", ["diff", "--stat"]],
		isFingerprinted: false,
		timeoutMs: 800,
	},
	{
		key: "bash:git log",
		label: "git log -n 10",
		patterns: [/^git log(?: --oneline)?(?: -n? ?\d{1,3})?$/, /^git log -\d{1,2}$/],
		intentTags: ["review", "debug"],
		runArgv: ["git", ["log", "--oneline", "-n", "10"]],
		isFingerprinted: false,
		timeoutMs: 800,
	},
	{
		key: "bash:cat package.json",
		label: "cat package.json",
		patterns: [/^cat package\.json$/],
		intentTags: ["review", "build"],
		runArgv: ["cat", ["package.json"]],
		isFingerprinted: false,
		timeoutMs: 200,
	},
	{
		key: "bash:ls",
		label: "ls",
		patterns: [/^ls$/, /^ls -la?$/, /^ls -la$/, /^ls src$/, /^ls -la? src$/],
		intentTags: ["review", "debug"],
		runArgv: ["ls", ["-la"]],
		isFingerprinted: false,
		timeoutMs: 200,
	},
	// Legacy hidden-context git ghost keys (produced by warmGhostTools via
	// pushGitGhost). They route on the bare "--short" / "--name-only" forms
	// directly via normalizeBashCacheCommand's early returns, so their
	// patterns here just need to round-trip via commandClassByKey for the
	// validity check.
	{
		key: "git_status_short:status --short",
		label: "git status --short",
		patterns: [/^git status --short$/, /^git status -s$/],
		intentTags: ["review", "debug"],
		runArgv: ["git", ["status", "--short"]],
		isFingerprinted: false,
		timeoutMs: 800,
	},
	{
		key: "git_diff_name_only:diff --name-only",
		label: "git diff --name-only",
		patterns: [/^git diff --name-only$/],
		intentTags: ["review", "debug"],
		runArgv: ["git", ["diff", "--name-only"]],
		isFingerprinted: false,
		timeoutMs: 800,
	},
]);

export function findCommandClass(command: string): CommandClass | undefined {
	const normalized = command.trim().replace(/\s+/g, " ");
	for (const cls of COMMAND_CLASSES) {
		if (cls.patterns.some((re) => re.test(normalized))) return cls;
	}
	return undefined;
}

export function commandClassByKey(key: string): CommandClass | undefined {
	return COMMAND_CLASSES.find((cls) => cls.key === key);
}

/** Read-only access for tests and downstream packages. */
export function listCommandClasses(): ReadonlyArray<{ key: string; label: string; intentTags: string[]; isFingerprinted: boolean }> {
	return COMMAND_CLASSES.map((c) => ({ key: c.key, label: c.label, intentTags: [...c.intentTags], isFingerprinted: c.isFingerprinted }));
}

const DECISION_WORDS = /\b(should|must|recommend|choose|route|decide|best|always|never|use this|do this)\b/i;

export function createPrecogState(config: Partial<PrecogConfig> = {}): PrecogState {
	return {
		config: { ...DEFAULT_PRECOG_CONFIG, ...config },
		lastDraft: "",
		snapshot: {
			cwd: "",
			changedFiles: [],
			knownFiles: [],
			collectedAt: 0,
			source: "empty",
		},
		warmedFiles: [],
		ghostTools: [],
		pendingGhostTools: new Map(),
		stats: {
			draftsSeen: 0,
			analyzed: 0,
			duplicateDrafts: 0,
			cacheHits: 0,
			totalAnalyzeMs: 0,
			lastAnalyzeMs: 0,
			maxAnalyzeMs: 0,
			lastInjectionChars: 0,
			snapshotRefreshes: 0,
			prefetches: 0,
			lastPrefetchMs: 0,
			maxPrefetchMs: 0,
			ghostToolWarms: 0,
			lastGhostToolMs: 0,
			maxGhostToolMs: 0,
			toolCacheHits: 0,
			toolCacheMisses: 0,
		},
	};
}

export function resetPrecogSessionState(state: PrecogState, cwd = ""): void {
	state.lastDraft = "";
	state.evidence = undefined;
	state.warmedFiles = [];
	state.ghostTools = [];
	state.pendingGhostTools.clear();

	state.snapshot = {
		cwd,
		changedFiles: [],
		knownFiles: [],
		collectedAt: 0,
		source: "empty",
	};
	state.stats.lastInjectionChars = 0;
	state.stats.prefetches = 0;
	state.stats.lastPrefetchMs = 0;
	state.stats.maxPrefetchMs = 0;
	state.stats.ghostToolWarms = 0;
	state.stats.lastGhostToolMs = 0;
	state.stats.maxGhostToolMs = 0;
	state.stats.toolCacheHits = 0;
	state.stats.toolCacheMisses = 0;
}

export function observeDraft(state: PrecogState, draft: string, now = Date.now()): PrecogEvidence | undefined {
	state.stats.draftsSeen += 1;
	if (draft === state.lastDraft) {
		state.stats.duplicateDrafts += 1;
		if (state.evidence && now - state.evidence.createdAt <= state.config.ttlMs) {
			state.stats.cacheHits += 1;
		}
		return state.evidence;
	}

	const started = performance.now();
	state.lastDraft = draft;
	state.evidence = analyzeDraft(draft, state.snapshot, state.config, now);
	const elapsed = performance.now() - started;
	state.stats.analyzed += 1;
	state.stats.totalAnalyzeMs += elapsed;
	state.stats.lastAnalyzeMs = elapsed;
	state.stats.maxAnalyzeMs = Math.max(state.stats.maxAnalyzeMs, elapsed);
	return state.evidence;
}

export function updateSnapshot(state: PrecogState, snapshot: Partial<PrecogSnapshot>): void {
	state.snapshot = {
		cwd: snapshot.cwd ?? state.snapshot.cwd,
		changedFiles: stableUnique(snapshot.changedFiles ?? []).slice(0, 200),
		knownFiles: stableUnique(snapshot.knownFiles ?? []).slice(0, 5000),
		collectedAt: snapshot.collectedAt ?? Date.now(),
		source: snapshot.source ?? "unknown",
	};
	state.stats.snapshotRefreshes += 1;
	if (state.lastDraft) {
		state.evidence = analyzeDraft(state.lastDraft, state.snapshot, state.config, Date.now());
	}
}

export function analyzeDraft(
	draft: string,
	snapshot: Partial<PrecogSnapshot> = {},
	config: Partial<PrecogConfig> = {},
	now = Date.now(),
): PrecogEvidence {
	const merged = { ...DEFAULT_PRECOG_CONFIG, ...config };
	const normalizedDraft = String(draft ?? "").slice(0, 4000);
	const refs = extractFileRefs(normalizedDraft, snapshot.knownFiles ?? [], merged.maxRefs);
	const changed = correlateChangedFiles(normalizedDraft, snapshot.changedFiles ?? [], merged.maxChanged);
	const intentTags = extractIntentTags(normalizedDraft, merged.maxIntentTags);

	const observations: string[] = [];
	if (refs.length > 0) observations.push(`draft mentions paths: ${refs.join(", ")}`);
	if (changed.length > 0) observations.push(`git has related changed files: ${changed.join(", ")}`);
	if (intentTags.length > 0) observations.push(`intent words observed: ${intentTags.join(", ")}`);

	return {
		draftHash: fnv1a(normalizedDraft),
		createdAt: now,
		refs,
		changed,
		intentTags,
		observations,
		summary: clampText(observations.join("; "), merged.maxEvidenceChars),
		confidence: scoreConfidence(refs, changed, intentTags),
		snapshotAgeMs: snapshot.collectedAt ? Math.max(0, now - snapshot.collectedAt) : undefined,
		source: snapshot.source ?? "none",
	};
}

export function buildInjection(
	evidence: PrecogEvidence | undefined,
	config: Partial<PrecogConfig> = {},
	warmedFiles: WarmedFileEvidence[] = [],
	ghostTools: GhostToolResult[] = [],
) {
	const merged = { ...DEFAULT_PRECOG_CONFIG, ...config };
	if (!evidence || evidence.observations.length === 0) return undefined;
	if (evidence.confidence < 0.25) return undefined;

	const mode = injectionMode();
	if (mode === "silent-futures") return undefined;
	if (mode === "verified-futures") {
		const futures = formatVerifiedFutures(ghostTools);
		if (!futures) return undefined;
		const content = clampText(`Verified tool futures armed; use normal tools. Validated on call: ${futures}`, merged.maxInjectionChars);
		return {
			customType: "pi-precognition",
			display: false,
			content,
			details: {
				refs: evidence.refs,
				changed: evidence.changed,
				intentTags: evidence.intentTags,
				confidence: evidence.confidence,
				source: evidence.source,
				snapshotAgeMs: evidence.snapshotAgeMs,
				injectionMode: mode,
				ghostTools: ghostTools.map((t) => ({ name: t.name, key: t.key, path: t.path, bytes: t.bytes, collectedAt: t.collectedAt })),
			},
		};
	}
	const warmed = mode === "cache-index" ? formatWarmedFileIndex(warmedFiles) : formatWarmedFiles(warmedFiles);
	const ghosts = mode === "cache-index" ? formatGhostToolIndex(ghostTools) : formatGhostTools(ghostTools);
	const content = clampText([
		"Precognition observations only. Evidence warmed while the operator was drafting.",
		mode === "cache-index"
			? "Cache-index mode: warmed content is held in Pi's local tool cache; call normal read/bash/grep if the exact evidence is needed."
			: "",
		evidence.summary,
		warmed ? `\nwarmed read-only ${mode === "cache-index" ? "index" : "evidence"}:\n${warmed}` : "",
		ghosts ? `\nghost tool ${mode === "cache-index" ? "index" : "results"}:\n${ghosts}` : "",
	].join("\n"), merged.maxInjectionChars);

	return {
		customType: "pi-precognition",
		display: false,
		content,
		details: {
			refs: evidence.refs,
			changed: evidence.changed,
			intentTags: evidence.intentTags,
			confidence: evidence.confidence,
			source: evidence.source,
			snapshotAgeMs: evidence.snapshotAgeMs,
			warmedFiles: warmedFiles.map((f) => ({ path: f.path, bytes: f.bytes, collectedAt: f.collectedAt })),
			ghostTools: ghostTools.map((t) => ({ name: t.name, key: t.key, path: t.path, bytes: t.bytes, collectedAt: t.collectedAt })),
		},
	};
}

/**
 * Format the live status line. Vocabulary discipline:
 *   - watching: session armed, no useful draft yet
 *   - armed: futures warmed and ready
 *   - validated/served: cache hit (formatted separately via formatHitReceipt)
 *   - rejected: stale future refused
 *   - no signal: confidence too low to warm
 *
 * Style: minimal, legible, receipt-driven. Never debug spam.
 */
export function formatWidget(evidence: PrecogEvidence | undefined, state: PrecogState): string {
	const mode = (process.env.PI_PRECOG_INJECTION_MODE ?? "silent-futures");
	const modeTag = mode === "silent-futures" ? "silent" : mode;
	const warmed = state.warmedFiles.length;
	const ghosts = state.ghostTools.length;
	const armed = warmed + ghosts;

	// No evidence or weak evidence → watching state
	if (!evidence || evidence.confidence < 0.25) {
		return `precog · watching · ${modeTag}`;
	}

	// Evidence exists but nothing actually warmed → no deterministic futures
	if (armed === 0) {
		return `precog · no deterministic futures · ${modeTag}`;
	}

	// Futures armed
	const plural = armed === 1 ? "future" : "futures";
	const hasFingerprint = state.ghostTools.some((t) => t.causalFiles && t.causalFiles.length > 0);
	const fpTag = hasFingerprint ? " · fingerprinted" : "";
	return `precog · ${armed} ${plural} armed · ${modeTag}${fpTag}`;
}

/**
 * Format the "money moment" — a cache hit receipt. This is what the operator
 * sees when a future just saved them a wait.
 *
 *   precog ✓ bash:npm test · 15.2s → 29ms · fingerprint ok
 *
 * `coldEstimateMs` is the modeled wait the tool would have cost without
 * precognition (e.g. 750ms for npm test, 5ms for read). Caller passes it
 * because the wrapper knows the served class.
 */
export function formatHitReceipt(opts: {
	tool: "read" | "bash" | "grep";
	key: string;
	servedMs: number;
	coldEstimateMs: number;
	fingerprintValidated: boolean;
}): string {
	const { key, servedMs, coldEstimateMs, fingerprintValidated } = opts;
	const cold = formatDuration(coldEstimateMs);
	const served = formatDuration(servedMs);
	const fpTag = fingerprintValidated ? " · fingerprint ok" : " · ttl ok";
	return `precog ✓ ${key} · ${cold} → ${served}${fpTag}`;
}

/**
 * Format a stale-future-rejected receipt.
 *
 *   precog · stale future rejected · fallback safe
 */
export function formatStaleRejection(opts: { tool: string; key: string }): string {
	return `precog · stale future rejected · fallback safe`;
}

/**
 * Format a session summary line (called at session_end if available).
 *
 *   precog · armed 3 · hits 1 · saved 15.2s · silent
 */
export function formatSessionSummary(state: PrecogState): string {
	const mode = (process.env.PI_PRECOG_INJECTION_MODE ?? "silent-futures");
	const modeTag = mode === "silent-futures" ? "silent" : mode;
	const armed = state.stats.ghostToolWarms;
	const hits = state.stats.toolCacheHits;
	// We don't track savedMs in state.stats yet; show hits-only summary
	if (hits === 0 && armed === 0) {
		return `precog · no activity · ${modeTag}`;
	}
	return `precog · armed ${armed} · hits ${hits} · ${modeTag}`;
}

function formatDuration(ms: number): string {
	if (ms < 1) return `${ms.toFixed(2)}ms`;
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function snapshotStats(state: PrecogState) {
	const analyzed = Math.max(1, state.stats.analyzed);
	return {
		...state.stats,
		avgAnalyzeMs: state.stats.totalAnalyzeMs / analyzed,
		evidence: state.evidence,
		warmedFiles: state.warmedFiles.map((f) => ({ path: f.path, bytes: f.bytes, collectedAt: f.collectedAt })),
		ghostTools: state.ghostTools.map((t) => ({ name: t.name, key: t.key, path: t.path, bytes: t.bytes, collectedAt: t.collectedAt })),
		snapshot: {
			...state.snapshot,
			knownFiles: state.snapshot.knownFiles.length,
			changedFiles: state.snapshot.changedFiles.length,
		},
	};
}

export function assertObservationLanguage(text: string): boolean {
	return !DECISION_WORDS.test(text);
}

export function tryGhostToolCache(
	state: PrecogState,
	toolName: "read" | "bash" | "grep",
	params: Record<string, any>,
): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } | undefined {
	let result: GhostToolResult | undefined;
	if (toolName === "read") {
		const path = normalizeReadCachePath(state, String(params?.path ?? ""));
		if (!path || params?.offset !== undefined || params?.limit !== undefined) {
			state.stats.toolCacheMisses += 1;
			return undefined;
		}
		result = state.ghostTools.find((tool) => tool.name === "read" && tool.path === path);
		if (result && !isReadFutureStillValid(state, result)) {
			state.stats.toolCacheMisses += 1;
			return undefined;
		}
	} else if (toolName === "bash") {
		const command = normalizeBashCacheCommand(String(params?.command ?? ""));
		if (!command) {
			state.stats.toolCacheMisses += 1;
			return undefined;
		}
		result = state.ghostTools.find((tool) => tool.key === command);
		if (result && !isCommandFutureStillValid(state, result)) {
			state.stats.toolCacheMisses += 1;
			return undefined;
		}
	} else if (toolName === "grep") {
		result = matchRgGhost(state, params);
	}

	if (!result) {
		state.stats.toolCacheMisses += 1;
		return undefined;
	}
	state.stats.toolCacheHits += 1;
	return {
		content: [{ type: "text", text: result.content || "(no output)" }],
		details: {
			precogCacheHit: true,
			precogKey: result.key,
			precogCollectedAt: result.collectedAt,
			precogBytes: result.bytes,
		},
	};
}

export async function tryGhostToolCacheAsync(
	state: PrecogState,
	toolName: "read" | "bash" | "grep",
	params: Record<string, any>,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } | undefined> {
	if (toolName === "bash") {
		const command = normalizeBashCacheCommand(String(params?.command ?? ""));
		const pending = command ? state.pendingGhostTools.get(command) : undefined;
		if (pending && !state.ghostTools.some((tool) => tool.key === command)) {
			const future = await pending.catch(() => undefined);
			if (future && !state.ghostTools.some((tool) => tool.key === future.key)) {
				state.ghostTools = [...state.ghostTools, future].slice(0, MAX_GHOST_TOOLS);
			}
			return tryGhostToolCache(state, toolName, params);
		}
	}
	const immediate = tryGhostToolCache(state, toolName, params);
	if (immediate || toolName !== "bash") return immediate;
	const command = normalizeBashCacheCommand(String(params?.command ?? ""));
	if (!command) return undefined;
	const pending = state.pendingGhostTools.get(command);
	if (!pending) return undefined;
	const future = await pending.catch(() => undefined);
	if (future && !state.ghostTools.some((tool) => tool.key === future.key)) {
		state.ghostTools = [...state.ghostTools, future].slice(0, MAX_GHOST_TOOLS);
	}
	return tryGhostToolCache(state, toolName, params);
}

export function extractFileRefs(draft: string, knownFiles: string[] = [], limit = DEFAULT_PRECOG_CONFIG.maxRefs): string[] {
	const refs: string[] = [];
	const patterns = [
		/`([^`\n]+\.[A-Za-z0-9]{1,8}(?::\d{1,6})?)`/g,
		/(?:^|\s)([@./~A-Za-z0-9_-][@./~A-Za-z0-9_-]*\.[A-Za-z0-9]{1,8}(?::\d{1,6})?)/g,
	];
	for (const pattern of patterns) {
		for (const match of draft.matchAll(pattern)) {
			const cleaned = normalizePathToken(match[1] ?? "");
			if (cleaned) refs.push(cleaned);
		}
	}

	const lower = draft.toLowerCase();
	for (const file of knownFiles) {
		if (refs.length >= limit) break;
		const base = file.split("/").pop()?.toLowerCase();
		const stem = base?.replace(/\.[^.]+$/, "");
		if (base && base.length > 2 && lower.includes(base)) refs.push(file);
		else if (stem && stem.length > 2 && lower.includes(stem)) refs.push(file);
	}

	return stableUnique(refs).slice(0, limit);
}

export function correlateChangedFiles(draft: string, changedFiles: string[] = [], limit = DEFAULT_PRECOG_CONFIG.maxChanged): string[] {
	const lower = draft.toLowerCase();
	const scored: Array<[number, string]> = [];
	for (const file of changedFiles) {
		const base = file.split("/").pop()?.toLowerCase() ?? "";
		const stem = base.replace(/\.[^.]+$/, "");
		let score = 0;
		if (base && lower.includes(base)) score += 3;
		if (stem.length > 2 && lower.includes(stem)) score += 2;
		if (lower.includes(file.toLowerCase())) score += 4;
		if (score > 0) scored.push([score, file]);
	}
	return stableUnique(scored.sort((a, b) => b[0] - a[0]).map(([, file]) => file)).slice(0, limit);
}

export function extractIntentTags(draft: string, limit = DEFAULT_PRECOG_CONFIG.maxIntentTags): string[] {
	const tags: string[] = [];
	for (const [tag, pattern] of COMMAND_TAGS) {
		if (pattern.test(draft)) tags.push(tag);
	}
	return tags.slice(0, limit);
}

export async function refreshGitSnapshot(state: PrecogState, cwd: string): Promise<void> {
	const [changedFiles, knownFiles] = await Promise.all([gitChangedFiles(cwd), gitKnownFiles(cwd)]);
	updateSnapshot(state, {
		cwd,
		changedFiles,
		knownFiles: stableUnique([...changedFiles, ...knownFiles]),
		collectedAt: Date.now(),
		source: changedFiles.length > 0 || knownFiles.length > 0 ? "git" : "draft",
	});
	await debugLog({ event: "snapshot_refreshed", changedFiles: changedFiles.length, knownFiles: knownFiles.length });
}

export async function warmReadOnlyEvidence(
	state: PrecogState,
	cwd: string,
	evidence: PrecogEvidence | undefined = state.evidence,
): Promise<WarmedFileEvidence[]> {
	if (!evidence || evidence.confidence < 0.25) {
		state.warmedFiles = [];
		return [];
	}

	const started = performance.now();
	const candidates = stableUnique([...evidence.refs, ...evidence.changed]).slice(0, MAX_WARMED_FILES * 2);
	const warmed: WarmedFileEvidence[] = [];
	for (const candidate of candidates) {
		if (warmed.length >= MAX_WARMED_FILES) break;
		const safe = resolveSafeRepoFile(cwd, candidate);
		if (!safe) continue;
		try {
			const real = await resolveRealRepoFile(cwd, safe.absolute);
			if (!real) continue;
			const meta = await stat(real.absolute);
			if (!meta.isFile() || meta.size > MAX_WARM_FILE_BYTES) continue;
			const buffer = await readFile(real.absolute);
			if (looksBinary(buffer)) continue;
			const text = buffer.toString("utf8");
			warmed.push({
				path: real.relative,
				bytes: Buffer.byteLength(text),
				excerpt: excerptText(text, MAX_WARM_EXCERPT_CHARS),
				collectedAt: Date.now(),
			});
		} catch {
			continue;
		}
	}

	const elapsed = performance.now() - started;
	state.warmedFiles = warmed;
	state.stats.prefetches += 1;
	state.stats.lastPrefetchMs = elapsed;
	state.stats.maxPrefetchMs = Math.max(state.stats.maxPrefetchMs, elapsed);
	await debugLog({ event: "warm_read_only_evidence", files: warmed.length, ms: elapsed });
	return warmed;
}

export async function warmGhostTools(
	state: PrecogState,
	cwd: string,
	evidence: PrecogEvidence | undefined = state.evidence,
): Promise<GhostToolResult[]> {
	if (!evidence || evidence.confidence < 0.25) {
		// Don't clobber the lattice-driven / cross-turn-primer warms.
		// Just no-op when local evidence is too weak.
		return state.ghostTools;
	}

	const started = performance.now();
	const tools: GhostToolResult[] = [];
	const seen = new Set<string>();
	const candidates = stableUnique([...evidence.refs, ...evidence.changed]).slice(0, MAX_WARMED_FILES * 2);
	const causalCandidates: string[] = [];
	for (const candidate of candidates) {
		if (tools.length >= MAX_GHOST_TOOLS) break;
		const file = await readSafeRepoText(cwd, candidate);
		if (!file) continue;
		const key = `read:${file.relative}`;
		if (seen.has(key)) continue;
		seen.add(key);
		tools.push({
			name: "read",
			key,
			args: [file.relative],
			path: file.relative,
			content: excerptText(file.text, MAX_GHOST_RESULT_CHARS),
			bytes: Buffer.byteLength(file.text),
			collectedAt: Date.now(),
			fileMtimeMs: file.mtimeMs,
			fileSize: file.size,
			chainDepth: 1,
		});
		causalCandidates.push(...extractLocalImportRefs(file.relative, file.text));
	}

	// chain-depth-2 — walk local imports of every depth-1 file
	// and warm those too, bounded by MAX_GHOST_TOOLS.
	const CHAIN_DEPTH_2_BUDGET = Number(process.env.PI_PRECOG_CHAIN_DEPTH_2_BUDGET ?? 4);
	let chainHopsRemaining = CHAIN_DEPTH_2_BUDGET;
	for (const candidate of stableUnique(causalCandidates)) {
		if (tools.length >= MAX_GHOST_TOOLS) break;
		if (chainHopsRemaining <= 0) break;
		const file = await readSafeRepoText(cwd, candidate);
		if (!file) continue;
		const key = `read:${file.relative}`;
		if (seen.has(key)) continue;
		seen.add(key);
		chainHopsRemaining -= 1;
		tools.push({
			name: "read",
			key,
			args: [file.relative],
			path: file.relative,
			content: excerptText(file.text, MAX_GHOST_RESULT_CHARS),
			bytes: Buffer.byteLength(file.text),
			collectedAt: Date.now(),
			fileMtimeMs: file.mtimeMs,
			fileSize: file.size,
			chainDepth: 2,
		});
	}

	await pushGitGhost(tools, seen, cwd, "git_status_short", ["status", "--short"]);
	await pushGitGhost(tools, seen, cwd, "git_diff_name_only", ["diff", "--name-only"]);
	if (commandFuturesEnabled()) {
		// The cache-delay mechanism (src/cache-delay.ts) handles the
		// "cheap diagnostic seduction" problem by shaping the served
		// latency to match cold-tool latency. No content-aware suppression
		// needed — the model sees a uniform latency distribution.
		for (const cls of COMMAND_CLASSES) {
			if (tools.length >= MAX_GHOST_TOOLS) break;
			if (seen.has(cls.key)) continue;
			if (!cls.intentTags.some((tag) => evidence.intentTags.includes(tag))) continue;
			const future = await ensureCommandGhost(state, cwd, cls.key);
			if (future && !seen.has(future.key)) {
				seen.add(future.key);
				tools.push(future);
			}
		}
	}

	const literal = extractSearchLiteral(state.lastDraft);
	if (literal) await pushRgGhost(tools, seen, cwd, literal);

	const elapsed = performance.now() - started;
	// Merge with existing ghostTools (e.g. from lattice prime) instead of clobbering.
	const existingKeys = new Set(state.ghostTools.map((t) => t.key));
	const additions = tools.filter((t) => !existingKeys.has(t.key));
	state.ghostTools = [...state.ghostTools, ...additions].slice(0, MAX_GHOST_TOOLS);
	state.stats.ghostToolWarms += 1;
	state.stats.lastGhostToolMs = elapsed;
	state.stats.maxGhostToolMs = Math.max(state.stats.maxGhostToolMs, elapsed);
	await debugLog({ event: "warm_ghost_tools", tools: state.ghostTools.length, ms: elapsed });
	return state.ghostTools;
}

export async function gitChangedFiles(cwd: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync("git", ["status", "--short"], {
			cwd,
			timeout: 800,
			maxBuffer: 64 * 1024,
		});
		return stdout
			.split("\n")
			.map((line) => line.slice(3).trim())
			.map((line) => line.replace(/^"|"$/g, ""))
			.filter(Boolean)
			.slice(0, 200);
	} catch {
		return [];
	}
}

export async function gitKnownFiles(cwd: string): Promise<string[]> {
	try {
		const { stdout } = await execFileAsync("git", ["ls-files"], {
			cwd,
			timeout: 800,
			maxBuffer: 256 * 1024,
		});
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.filter((line) => !SECRET_PATH_RE.test(line))
			.filter((line) => !line.includes("/node_modules/") && !line.startsWith("node_modules/") && !line.includes("/.git/") && !line.startsWith(".git/"))
			.slice(0, 5000);
	} catch {
		return [];
	}
}

export async function debugLog(payload: Record<string, unknown>): Promise<void> {
	const target = process.env.PI_PRECOG_LOG;
	if (!target) return;
	await appendFile(target, `${JSON.stringify({ at: Date.now(), ...payload })}\n`).catch(() => {});
}

async function pushGitGhost(
	tools: GhostToolResult[],
	seen: Set<string>,
	cwd: string,
	name: "git_status_short" | "git_diff_name_only",
	args: string[],
): Promise<void> {
	if (tools.length >= MAX_GHOST_TOOLS) return;
	const key = `${name}:${args.join(" ")}`;
	if (seen.has(key)) return;
	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd,
			timeout: GHOST_TOOL_TIMEOUT_MS,
			maxBuffer: 64 * 1024,
		});
		const content = filterGitPathOutput(cwd, stdout, name === "git_status_short");
		if (!content) return;
		seen.add(key);
		tools.push({
			name,
			key,
			args,
			content,
			bytes: Buffer.byteLength(content),
			collectedAt: Date.now(),
		});
	} catch {
		return;
	}
}

async function pushRgGhost(tools: GhostToolResult[], seen: Set<string>, cwd: string, literal: string): Promise<void> {
	if (tools.length >= MAX_GHOST_TOOLS) return;
	const key = `rg_literal:${literal}`;
	if (seen.has(key)) return;
	try {
		const { stdout } = await execFileAsync("rg", [
			"--line-number",
			"--fixed-strings",
			"--max-count",
			"8",
			"--glob",
			"!.env",
			"--glob",
			"!.env.*",
			"--glob",
			"!**/.env",
			"--glob",
			"!**/.env.*",
			"--glob",
			"!**/secrets/**",
			"--glob",
			"!**/.git/**",
			"--glob",
			"!**/node_modules/**",
			literal,
		], {
			cwd,
			timeout: GHOST_TOOL_TIMEOUT_MS,
			maxBuffer: 64 * 1024,
		});
		const content = filterRgOutput(cwd, stdout);
		if (!content) return;
		seen.add(key);
		tools.push({
			name: "rg_literal",
			key,
			args: [literal],
			content,
			bytes: Buffer.byteLength(content),
			collectedAt: Date.now(),
		});
	} catch {
		return;
	}
}

function ensureNpmTestGhost(state: PrecogState, cwd: string): Promise<GhostToolResult | undefined> {
	return ensureCommandGhost(state, cwd, "bash:npm test");
}

export function ensureCommandGhost(state: PrecogState, cwd: string, classKey: string): Promise<GhostToolResult | undefined> {
	const cls = commandClassByKey(classKey);
	if (!cls) return Promise.resolve(undefined);
	const pending = state.pendingGhostTools.get(cls.key);
	if (pending) return pending;
	const future = collectCommandGhost(cwd, cls).finally(() => {
		state.pendingGhostTools.delete(cls.key);
	});
	state.pendingGhostTools.set(cls.key, future);
	return future;
}

async function collectCommandGhost(cwd: string, cls: CommandClass): Promise<GhostToolResult | undefined> {
	try {
		const packageFile = await readSafeRepoText(cwd, "package.json").catch(() => undefined);
		if (cls.precondition && !cls.precondition(cwd, packageFile?.text)) return undefined;

		let causalFiles: Array<{ path: string; mtimeMs: number; size: number; sha1: string }> = [];
		if (cls.isFingerprinted) {
			causalFiles = await collectCommandCausalFiles(cwd, cls.causalFilter);
			if (causalFiles.length === 0) return undefined;
		}
		const [bin, args] = cls.runArgv;
		const { stdout, stderr } = await execFileAsync(bin, args, {
			cwd,
			timeout: cls.timeoutMs ?? Number(process.env.PI_PRECOG_COMMAND_TIMEOUT_MS ?? 8_000),
			maxBuffer: 128 * 1024,
			env: { ...process.env, NO_COLOR: "1" },
		});
		if (cls.isFingerprinted) {
			if (!sameCausalFiles(causalFiles, await collectCommandCausalFiles(cwd, cls.causalFilter))) return undefined;
		}
		const content = clampText(`${stdout}${stderr}`.trim() || "(no output)", MAX_GHOST_RESULT_CHARS);
		return {
			name: "bash_command",
			key: cls.key,
			args: [cls.label],
			content,
			bytes: Buffer.byteLength(content),
			collectedAt: Date.now(),
			causalFiles: cls.isFingerprinted ? causalFiles : undefined,
		};
	} catch (err: any) {
		let causalFiles: Array<{ path: string; mtimeMs: number; size: number; sha1: string }> = [];
		if (cls.isFingerprinted) {
			causalFiles = await collectCommandCausalFiles(cwd, cls.causalFilter).catch(() => []);
			if (causalFiles.length === 0) return undefined;
		}
		const content = clampText(`${err?.stdout ?? ""}${err?.stderr ?? err?.message ?? ""}`.trim() || "(command failed)", MAX_GHOST_RESULT_CHARS);
		return {
			name: "bash_command",
			key: cls.key,
			args: [cls.label],
			content,
			bytes: Buffer.byteLength(content),
			collectedAt: Date.now(),
			causalFiles: cls.isFingerprinted ? causalFiles : undefined,
		};
	}
}

export function resolveSafeRepoFile(cwd: string, token: string): { absolute: string; relative: string } | undefined {
	if (!cwd || !token) return undefined;
	if (token.startsWith("~") || token.startsWith("/") || token.includes("\0")) return undefined;
	const root = resolve(cwd);
	const absolute = resolve(root, token);
	if (absolute !== root && !absolute.startsWith(root + sep)) return undefined;
	const rel = relative(root, absolute).split(sep).join("/");
	if (!rel || rel.startsWith("..") || SECRET_PATH_RE.test(rel)) return undefined;
	if (rel.includes("/node_modules/") || rel.startsWith("node_modules/") || rel.includes("/.git/") || rel.startsWith(".git/")) return undefined;
	return { absolute, relative: rel };
}

export function resolveSafeRepoPath(cwd: string, token: string): { absolute: string; relative: string } | undefined {
	return resolveSafeRepoFile(cwd, token);
}

export async function resolveRealRepoFile(cwd: string, absolute: string): Promise<{ absolute: string; relative: string } | undefined> {
	const root = await realpath(cwd);
	const resolved = await realpath(absolute);
	if (resolved !== root && !resolved.startsWith(root + sep)) return undefined;
	const rel = relative(root, resolved).split(sep).join("/");
	if (!rel || rel.startsWith("..") || SECRET_PATH_RE.test(rel)) return undefined;
	if (rel.includes("/node_modules/") || rel.startsWith("node_modules/") || rel.includes("/.git/") || rel.startsWith(".git/")) return undefined;
	return { absolute: resolved, relative: rel };
}

export async function readSafeRepoText(cwd: string, token: string): Promise<{ relative: string; text: string; mtimeMs: number; size: number } | undefined> {
	try {
		const safe = resolveSafeRepoFile(cwd, token);
		if (!safe) return undefined;
		const real = await resolveRealRepoFile(cwd, safe.absolute);
		if (!real) return undefined;
		const meta = await stat(real.absolute);
		if (!meta.isFile() || meta.size > MAX_WARM_FILE_BYTES) return undefined;
		const buffer = await readFile(real.absolute);
		if (looksBinary(buffer)) return undefined;
		return { relative: real.relative, text: buffer.toString("utf8"), mtimeMs: meta.mtimeMs, size: meta.size };
	} catch {
		return undefined;
	}
}

export function extractLocalImportRefs(fromRelative: string, text: string): string[] {
	const refs: string[] = [];
	const dir = posix.dirname(fromRelative);
	const patterns = [
		/\bimport\s+(?:[^'"]+\s+from\s+)?['"](\.[^'"]+)['"]/g,
		/\bexport\s+[^'"]*\s+from\s+['"](\.[^'"]+)['"]/g,
		/\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g,
	];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			const spec = match[1];
			if (!spec) continue;
			const normalized = posix.normalize(posix.join(dir, spec));
			if (/\.[A-Za-z0-9]{1,8}$/.test(normalized)) refs.push(normalized);
			else {
				for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) refs.push(`${normalized}${ext}`);
			}
		}
	}
	return stableUnique(refs).slice(0, MAX_GHOST_TOOLS);
}

function looksBinary(buffer: Buffer): boolean {
	const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
	if (sample.includes(0)) return true;
	const replacementChars = sample.toString("utf8").match(/\uFFFD/g)?.length ?? 0;
	return replacementChars > Math.max(2, sample.length * 0.01);
}

function filterGitPathOutput(cwd: string, stdout: string, statusMode: boolean): string {
	const lines: string[] = [];
	for (const raw of stdout.split("\n")) {
		if (!raw.trim()) continue;
		const token = statusMode ? raw.slice(3).trim().split(" -> ").pop() ?? "" : raw.trim();
		const safe = resolveSafeRepoPath(cwd, token.replace(/^"|"$/g, ""));
		if (!safe) continue;
		lines.push(statusMode ? `${raw.slice(0, 3)}${safe.relative}` : safe.relative);
	}
	return clampText(lines.join("\n"), MAX_GHOST_RESULT_CHARS);
}

function filterRgOutput(cwd: string, stdout: string): string {
	const lines: string[] = [];
	for (const raw of stdout.split("\n")) {
		if (!raw.trim()) continue;
		const idx = raw.indexOf(":");
		if (idx <= 0) continue;
		const safe = resolveSafeRepoPath(cwd, raw.slice(0, idx));
		if (!safe) continue;
		lines.push(`${safe.relative}${raw.slice(idx)}`);
	}
	return clampText(lines.join("\n"), MAX_GHOST_RESULT_CHARS);
}

function extractSearchLiteral(draft: string): string | undefined {
	const quoted = draft.match(/`([A-Za-z_$][A-Za-z0-9_$]{3,80})`/);
	if (quoted?.[1]) return quoted[1];
	return draft.match(/\b([A-Za-z_$][A-Za-z0-9_$]{3,80})\b/g)?.find((token) => {
		if (COMMAND_TAGS.some(([, pattern]) => pattern.test(token))) return false;
		if (/\.(ts|tsx|js|jsx|mjs|cjs|json|md|py|rb|go|rs|java|css|scss)$/i.test(token)) return false;
		return /[A-Z_$]/.test(token) || token.length >= 8;
	});
}

function normalizeBashCacheCommand(command: string): string | undefined {
	const normalized = command.trim().replace(/\s+/g, " ");
	// Legacy hidden-context git keys (preserved for warmGhostTools output paths).
	if (normalized === "git status --short" || normalized === "git status -s") return "git_status_short:status --short";
	if (normalized === "git diff --name-only") return "git_diff_name_only:diff --name-only";
	// registry-driven command class lookup.
	const cls = findCommandClass(normalized);
	if (cls) return cls.key;
	return undefined;
}

function commandFuturesEnabled(): boolean {
	return process.env.PI_PRECOG_COMMAND_FUTURES === "1" || process.env.PI_PRECOG_COMMAND_FUTURES === "true";
}

function matchRgGhost(state: PrecogState, params: Record<string, any>): GhostToolResult | undefined {
	if (params?.ignoreCase || params?.context || params?.glob) return undefined;
	if (params?.literal === false) return undefined;
	const searchPath = String(params?.path ?? ".").trim();
	if (searchPath && searchPath !== ".") return undefined;
	const pattern = String(params?.pattern ?? "").trim();
	if (!pattern) return undefined;
	return state.ghostTools.find((tool) => tool.name === "rg_literal" && tool.key === `rg_literal:${pattern}`);
}

function normalizeReadCachePath(state: PrecogState, token: string): string | undefined {
	const prepared = normalizePathToken(token);
	if (!prepared) return undefined;
	const cwd = state.snapshot.cwd ? resolve(state.snapshot.cwd) : "";
	if (cwd && token.trim().startsWith("/")) {
		const absolute = resolve(token.trim().replace(/:\d{1,6}$/, ""));
		if (absolute !== cwd && !absolute.startsWith(cwd + sep)) return undefined;
		const rel = relative(cwd, absolute).split(sep).join("/");
		return safeCacheRelativePath(rel);
	}
	return safeCacheRelativePath(prepared);
}

function isReadFutureStillValid(state: PrecogState, tool: GhostToolResult): boolean {
	if (tool.name !== "read" || !tool.path) return false;
	if (tool.fileMtimeMs === undefined || tool.fileSize === undefined) return false;
	const cwd = state.snapshot.cwd ? resolve(state.snapshot.cwd) : "";
	if (!cwd) return false;
	const relativePath = safeCacheRelativePath(tool.path);
	if (!relativePath) return false;
	try {
		const meta = statSync(resolve(cwd, relativePath));
		return meta.isFile() && meta.size === tool.fileSize && meta.mtimeMs === tool.fileMtimeMs;
	} catch {
		return false;
	}
}

function isCommandFutureStillValid(state: PrecogState, tool: GhostToolResult): boolean {
	if (tool.name !== "bash_command") return false;
	const cls = commandClassByKey(tool.key);
	if (!cls) return false;
	if (!cls.isFingerprinted) {
		// Unfingerprinted classes use TTL-only validation (handled via collectedAt + TTL).
		const ageMs = Date.now() - tool.collectedAt;
		return ageMs >= 0 && ageMs <= Number(process.env.PI_PRECOG_COMMAND_UNFINGERPRINTED_TTL_MS ?? 2_000);
	}
	const cwd = state.snapshot.cwd ? resolve(state.snapshot.cwd) : "";
	if (!cwd || !tool.causalFiles?.length) return false;
	try {
		const current = collectCommandCausalFilesSync(cwd, cls.causalFilter);
		return sameCausalFiles(tool.causalFiles, current);
	} catch {
		return false;
	}
}

async function collectCommandCausalFiles(cwd: string, filter: ((paths: string[]) => string[]) | undefined = undefined): Promise<Array<{ path: string; mtimeMs: number; size: number; sha1: string }>> {
	const paths = await commandCausalPaths(cwd, filter);
	const files: Array<{ path: string; mtimeMs: number; size: number; sha1: string }> = [];
	for (const path of paths) {
		const safe = resolveSafeRepoFile(cwd, path);
		if (!safe) continue;
		const real = await resolveRealRepoFile(cwd, safe.absolute);
		if (!real) continue;
		const meta = await stat(real.absolute);
		if (!meta.isFile()) continue;
		const bytes = await readFile(real.absolute);
		files.push({ path: real.relative, mtimeMs: meta.mtimeMs, size: meta.size, sha1: sha1(bytes) });
	}
	return files.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 256);
}

function collectCommandCausalFilesSync(cwd: string, filter: ((paths: string[]) => string[]) | undefined = undefined): Array<{ path: string; mtimeMs: number; size: number; sha1: string }> {
	const paths = commandCausalPathsSync(cwd, filter);
	const files: Array<{ path: string; mtimeMs: number; size: number; sha1: string }> = [];
	for (const path of paths) {
		const safe = resolveSafeRepoFile(cwd, path);
		if (!safe) continue;
		try {
			const meta = statSync(safe.absolute);
			if (!meta.isFile()) continue;
			files.push({ path: safe.relative, mtimeMs: meta.mtimeMs, size: meta.size, sha1: sha1(readFileSync(safe.absolute)) });
		} catch {
			continue;
		}
	}
	return files.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 256);
}

async function commandCausalPaths(cwd: string, filter: ((paths: string[]) => string[]) | undefined = undefined): Promise<string[]> {
	const pick = filter ?? commandRelevantPaths;
	const gitFiles = await gitKnownFiles(cwd);
	if (gitFiles.length > 0) return pick(gitFiles);
	const discovered = await discoverRepoFiles(cwd);
	return pick(discovered);
}

function commandCausalPathsSync(cwd: string, filter: ((paths: string[]) => string[]) | undefined = undefined): string[] {
	const pick = filter ?? commandRelevantPaths;
	try {
		const { stdout } = execFileSyncCompat("git", ["ls-files"], cwd);
		const gitFiles = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
		if (gitFiles.length > 0) return pick(gitFiles);
	} catch {
		// Fall back to a conservative top-level/source/test scan.
	}
	return pick(discoverRepoFilesSync(cwd));
}

async function discoverRepoFiles(cwd: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(prefix = ""): Promise<void> {
		if (out.length >= 512) return;
		let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
		try {
			entries = await readdir(resolve(cwd, prefix || "."), { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (out.length >= 512) break;
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (isSkippedTree(rel)) continue;
			if (entry.isDirectory()) await walk(rel);
			else if (entry.isFile()) out.push(rel);
		}
	}
	await walk();
	return out;
}

function discoverRepoFilesSync(cwd: string): string[] {
	const out: string[] = [];
	function walk(prefix = ""): void {
		if (out.length >= 512) return;
		let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
		try {
			entries = readdirSync(resolve(cwd, prefix || "."), { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (out.length >= 512) break;
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (isSkippedTree(rel)) continue;
			if (entry.isDirectory()) walk(rel);
			else if (entry.isFile()) out.push(rel);
		}
	}
	walk();
	return out;
}

function commandRelevantPaths(paths: string[]): string[] {
	return stableUnique(paths)
		.filter((path) => !SECRET_PATH_RE.test(path))
		.filter((path) => !isSkippedTree(path))
		.filter((path) => /^(package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|src\/.*|test\/.*|tests\/.*|__tests__\/.*|test\.[cm]?[jt]s|.*\.(?:test|spec)\.[cm]?[jt]sx?)$/i.test(path))
		.slice(0, 256);
}

function sameCausalFiles(a: Array<{ path: string; mtimeMs: number; size: number; sha1: string }>, b: Array<{ path: string; mtimeMs: number; size: number; sha1: string }>): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i].path !== b[i].path || a[i].size !== b[i].size || a[i].mtimeMs !== b[i].mtimeMs || a[i].sha1 !== b[i].sha1) return false;
	}
	return true;
}

function isSkippedTree(path: string): boolean {
	return path.includes("/node_modules/") || path.startsWith("node_modules/") ||
		path.includes("/.git/") || path.startsWith(".git/") ||
		path.includes("/dist/") || path.startsWith("dist/") ||
		path.includes("/coverage/") || path.startsWith("coverage/");
}

function execFileSyncCompat(command: string, args: string[], cwd: string): { stdout: string } {
	return { stdout: execFileSync(command, args, { cwd, timeout: 800, maxBuffer: 256 * 1024, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) };
}

function sha1(bytes: Buffer): string {
	return createHash("sha1").update(bytes).digest("hex");
}

function safeCacheRelativePath(token: string): string | undefined {
	let value = token.replace(/\\/g, "/");
	while (value.startsWith("./")) value = value.slice(2);
	if (!value || value.startsWith("/") || value.startsWith("../") || value.includes("/../")) return undefined;
	if (SECRET_PATH_RE.test(value)) return undefined;
	if (value.includes("/node_modules/") || value.startsWith("node_modules/") || value.includes("/.git/") || value.startsWith(".git/")) return undefined;
	return value;
}

function excerptText(text: string, maxChars: number): string {
	const lines = text.replace(/\r\n/g, "\n").split("\n").slice(0, 80);
	const numbered = lines.map((line, i) => `${i + 1}: ${line.slice(0, 180)}`).join("\n");
	return clampText(numbered, maxChars);
}

function formatWarmedFiles(files: WarmedFileEvidence[]): string {
	if (files.length === 0) return "";
	return clampText(files.map((file) => [
		`--- ${file.path} (${file.bytes} bytes) ---`,
		file.excerpt,
	].join("\n")).join("\n"), MAX_WARM_EXCERPT_CHARS);
}

function formatWarmedFileIndex(files: WarmedFileEvidence[]): string {
	if (files.length === 0) return "";
	return files.map((file) => `--- ${file.path} (${file.bytes} bytes cached) ---`).join("\n");
}

function formatGhostTools(tools: GhostToolResult[]): string {
	if (tools.length === 0) return "";
	return clampText(tools.map((tool) => [
		`--- ${tool.name} ${tool.path ?? tool.args.join(" ")} (${tool.bytes} bytes) ---`,
		tool.content,
	].join("\n")).join("\n"), MAX_GHOST_RESULT_CHARS);
}

function formatGhostToolIndex(tools: GhostToolResult[]): string {
	if (tools.length === 0) return "";
	return tools.map((tool) => `--- ${tool.name} ${tool.path ?? tool.args.join(" ")} (${tool.bytes} bytes cached) ---`).join("\n");
}

function formatVerifiedFutures(tools: GhostToolResult[]): string {
	return tools.map((tool) => tool.key).slice(0, MAX_GHOST_TOOLS).join(", ");
}

function injectionMode(): "full" | "cache-index" | "verified-futures" | "silent-futures" {
	// Default is silent-futures: zero hidden context. The README's
	// "hidden context injected: 0" claim is true with no env set.
	if (process.env.PI_PRECOG_INJECTION_MODE === "full") return "full";
	if (process.env.PI_PRECOG_INJECTION_MODE === "cache-index") return "cache-index";
	if (process.env.PI_PRECOG_INJECTION_MODE === "verified-futures") return "verified-futures";
	return "silent-futures";
}

function normalizePathToken(token: string): string | undefined {
	let value = token.trim();
	if (value.startsWith("@")) value = value.slice(1);
	value = value.replace(/[),.;\]]+$/, "");
	value = value.replace(/:\d{1,6}$/, "");
	if (value.includes("://")) return undefined;
	if (/^\d+(?:\.\d+)+$/.test(value)) return undefined;
	if (!/[./]/.test(value)) return undefined;
	if (value.length > 180) return undefined;
	return value;
}

function scoreConfidence(refs: string[], changed: string[], intentTags: string[]): number {
	let score = refs.length * 0.25 + changed.length * 0.18 + intentTags.length * 0.08;
	if (intentTags.some((tag) => tag === "test" || tag === "build" || tag === "review" || tag === "debug")) {
		score = Math.max(score, 0.25);
	}
	return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function stableUnique<T>(items: T[]): T[] {
	const seen = new Set<T>();
	const out: T[] = [];
	for (const item of items) {
		if (!item || seen.has(item)) continue;
		seen.add(item);
		out.push(item);
	}
	return out;
}

function clampText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, Math.max(0, maxChars - 12)).trimEnd()} [clamped]`;
}

function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
