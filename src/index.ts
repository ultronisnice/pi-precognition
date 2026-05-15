/**
 * pi-precognition
 *
 * Draft-time context warming for Pi agents. While the operator types, this
 * extension extracts obvious path/intent evidence and refreshes a tiny git
 * snapshot in the background. On submit, Pi can receive already-warmed evidence
 * or silent tool futures, so the model can skip predictable first waits.
 *
 * Hot path:
 * - terminal input: debounced in-memory string analysis only
 * - before_agent_start: injection formatting only
 * - git status: session-start/background only, 800ms timeout
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyCacheDelay } from "./cache-delay.ts";
import { exec } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";
import {
	buildInjection,
	createPrecogState,
	debugLog,
	formatWidget,
	observeDraft,
	readSafeRepoText,
	refreshGitSnapshot,
	resetPrecogSessionState,
	resolveSafeRepoPath,
	snapshotStats,
	tryGhostToolCacheAsync,
	tryGhostToolCache,
	warmGhostTools,
	warmReadOnlyEvidence,
} from "./core.ts";

const execAsync = promisify(exec);
const SENTINEL = "__pi_precognition_loaded__";
const STATUS_KEY = "pi.precognition";
const WIDGET_KEY = "pi.precognition";

const STATE = createPrecogState({
	maxEvidenceChars: Number(process.env.PI_PRECOG_MAX_EVIDENCE_CHARS ?? 720),
	maxInjectionChars: Number(process.env.PI_PRECOG_MAX_INJECTION_CHARS ?? 520),
	ttlMs: Number(process.env.PI_PRECOG_TTL_MS ?? 30_000),
});

let unsubscribeInput: (() => void) | undefined;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWarm = false;
let latestCtx: any;
let snapshotRefresh: Promise<void> | undefined;
let delayedSnapshotTimer: ReturnType<typeof setTimeout> | undefined;

export default function piPrecognition(pi: ExtensionAPI): void {
	if (process.env.PI_PRECOG === "0" || process.env.PI_PRECOG === "false") return;
	const g = globalThis as any;
	if (g[SENTINEL]) return;
	g[SENTINEL] = true;

	(pi as any).registerTool?.({
		name: "precognition_peek",
		label: "precog",
		description: "Inspect Precognition's draft-time warmed evidence for the current or last prompt. Observational only.",
		promptSnippet: "Inspect draft-time warmed evidence when useful.",
		parameters: Type.Object({}),
		executionMode: "parallel",
		async execute() {
			const stats = snapshotStats(STATE);
			return {
				content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
				details: stats,
			};
		},
	});

		(pi as any).on?.("session_start", async (_event: any, ctx: any) => {
			latestCtx = ctx;
			const cwd = String(ctx?.cwd ?? process.cwd());
			if (pendingTimer) clearTimeout(pendingTimer);
			if (delayedSnapshotTimer) clearTimeout(delayedSnapshotTimer);
			pendingTimer = undefined;
			delayedSnapshotTimer = undefined;
			pendingWarm = false;
			resetPrecogSessionState(STATE, cwd);
			if (process.env.PI_PRECOG_TOOL_CACHE === "1" || process.env.PI_PRECOG_TOOL_CACHE === "true") {
				registerCachedToolOverrides(pi, cwd);
			}
		if (ctx?.hasUI) {
			ctx.ui?.setStatus?.(STATUS_KEY, "armed");
			ctx.ui?.setWidget?.(WIDGET_KEY, ["precog: armed | idle"], { placement: "aboveEditor" });
			unsubscribeInput?.();
			unsubscribeInput = ctx.ui?.onTerminalInput?.(() => {
				queueMicrotask(() => scheduleObserve(ctx));
				return undefined;
			});
		}
		snapshotRefresh = refreshGitSnapshot(STATE, cwd).catch(() => undefined);
		const primeDraft = String(process.env.PI_PRECOG_PRIME_DRAFT ?? "");
		if (primeDraft.trim()) {
			await Promise.race([
				primeDraftFutures(cwd, primeDraft),
				delay(Number(process.env.PI_PRECOG_PRIME_BUDGET_MS ?? 500)),
			]);
		}
			delayedSnapshotTimer = setTimeout(() => void refreshGitSnapshot(STATE, cwd), 2_500);
			delayedSnapshotTimer.unref?.();
			await debugLog({ event: "session_start", cwd, hasUI: Boolean(ctx?.hasUI) });
		});

	(pi as any).on?.("before_agent_start", async (event: any) => {
		const draft = String(event?.prompt ?? latestCtx?.ui?.getEditorText?.() ?? "");
		if (STATE.snapshot.knownFiles.length === 0 && snapshotRefresh) {
			await Promise.race([
				snapshotRefresh,
				delay(Number(process.env.PI_PRECOG_SNAPSHOT_BUDGET_MS ?? 80)),
			]);
		}
		const evidence = observeDraft(STATE, draft);
		if (evidence?.confidence && evidence.confidence >= 0.25 && STATE.warmedFiles.length === 0 && STATE.ghostTools.length === 0) {
			await Promise.race([
				Promise.allSettled([
					warmReadOnlyEvidence(STATE, latestCtx?.cwd ?? process.cwd(), evidence),
					warmGhostTools(STATE, latestCtx?.cwd ?? process.cwd(), evidence),
				]),
				delay(Number(process.env.PI_PRECOG_SUBMIT_WARM_BUDGET_MS ?? 160)),
			]);
		}
		const message = buildInjection(STATE.evidence, STATE.config, STATE.warmedFiles, STATE.ghostTools);
		STATE.stats.lastInjectionChars = message?.content?.length ?? 0;
		void debugLog({
			event: "before_agent_start",
			promptHash: STATE.evidence?.draftHash,
			injected: Boolean(message),
			chars: STATE.stats.lastInjectionChars,
		});
		if (message) return { message };
		return undefined;
	});

	(pi as any).on?.("session_shutdown", () => {
		unsubscribeInput?.();
		unsubscribeInput = undefined;
			if (pendingTimer) clearTimeout(pendingTimer);
			if (delayedSnapshotTimer) clearTimeout(delayedSnapshotTimer);
			pendingTimer = undefined;
			delayedSnapshotTimer = undefined;
			pendingWarm = false;
			void debugLog({ event: "session_shutdown" });
		});
}

function scheduleObserve(ctx: any): void {
	if (!ctx?.hasUI) return;
	if (pendingTimer) clearTimeout(pendingTimer);
	pendingTimer = setTimeout(() => {
		pendingTimer = undefined;
		let draft = "";
		try {
			draft = String(ctx.ui?.getEditorText?.() ?? "");
		} catch {
			return;
		}
		const evidence = observeDraft(STATE, draft);
		const widget = formatWidget(evidence, STATE);
		ctx.ui?.setStatus?.(STATUS_KEY, widget.replace(/^precog:\s*/, ""));
		ctx.ui?.setWidget?.(WIDGET_KEY, [widget], { placement: "aboveEditor" });
		void debugLog({
			event: "draft_observed",
			draftHash: evidence?.draftHash,
			refs: evidence?.refs.length ?? 0,
			changed: evidence?.changed.length ?? 0,
			ms: STATE.stats.lastAnalyzeMs,
		});
		if (!pendingWarm && evidence?.confidence && evidence.confidence >= 0.25) {
			pendingWarm = true;
			void warmReadOnlyEvidence(STATE, ctx?.cwd ?? process.cwd(), evidence).catch(() => undefined).finally(() => {
				pendingWarm = false;
			});
			void warmGhostTools(STATE, ctx?.cwd ?? process.cwd(), evidence).catch(() => undefined);
		}
	}, Number(process.env.PI_PRECOG_DEBOUNCE_MS ?? 50));
	pendingTimer.unref?.();
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, Math.max(0, ms));
		timer.unref?.();
	});
}

async function primeDraftFutures(cwd: string, draft: string): Promise<void> {
	if (snapshotRefresh) {
		await Promise.race([
			snapshotRefresh,
			delay(Number(process.env.PI_PRECOG_SNAPSHOT_BUDGET_MS ?? 80)),
		]);
	}
	const evidence = observeDraft(STATE, draft);
	if (!evidence?.confidence || evidence.confidence < 0.25) return;
	await Promise.allSettled([
		warmReadOnlyEvidence(STATE, cwd, evidence),
		warmGhostTools(STATE, cwd, evidence),
	]);
	await debugLog({
		event: "prime_draft_futures",
		promptHash: evidence.draftHash,
		warmedFiles: STATE.warmedFiles.length,
		ghostTools: STATE.ghostTools.length,
	});
}

function registerCachedToolOverrides(pi: ExtensionAPI, cwd: string): void {
	(pi as any).registerTool?.({
		name: "read",
		label: "read",
		description: "Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
		promptSnippet: "Read file contents",
		promptGuidelines: ["Use read to examine files instead of cat or sed."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
			offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
		}),
		async execute(_toolCallId: string, params: any) {
			const hit = tryGhostToolCache(STATE, "read", params);
			if (hit) {
				void debugLog({ event: "tool_cache_hit", tool: "read", mode: "stable-contract", key: hit.details.precogKey });
				await applyCacheDelay("read");
				return hit;
			}
			void debugLog({ event: "tool_cache_miss", tool: "read" });
			return fallbackRead(cwd, params);
		},
	});

	(pi as any).registerTool?.({
		name: "bash",
		label: "bash",
		description: "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.",
		promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
		parameters: Type.Object({
			command: Type.String({ description: "Bash command to execute" }),
			timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
		}),
		async execute(_toolCallId: string, params: any) {
			const hit = await tryGhostToolCacheAsync(STATE, "bash", params);
			if (hit) {
				void debugLog({ event: "tool_cache_hit", tool: "bash", mode: "stable-contract", key: hit.details.precogKey });
				await applyCacheDelay("bash");
				return hit;
			}
			void debugLog({ event: "tool_cache_miss", tool: "bash" });
			return fallbackBash(cwd, params);
		},
	});

	(pi as any).registerTool?.({
		name: "grep",
		label: "grep",
		description: "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to 100 matches or 50KB (whichever is hit first). Long lines are truncated to 500 chars.",
		promptSnippet: "Search file contents for patterns (respects .gitignore)",
		parameters: Type.Object({
			pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
			path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
			glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
			ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
			literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
			context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
			limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
		}),
		async execute(_toolCallId: string, params: any) {
			const hit = tryGhostToolCache(STATE, "grep", params);
			if (hit) {
				void debugLog({ event: "tool_cache_hit", tool: "grep", mode: "stable-contract", key: hit.details.precogKey });
				await applyCacheDelay("grep");
				return hit;
			}
			void debugLog({ event: "tool_cache_miss", tool: "grep" });
			return fallbackGrep(cwd, params);
		},
	});
}

async function fallbackRead(cwd: string, params: any) {
	const safePath = safeRepoQueryPath(cwd, String(params?.path ?? ""));
	if (!safePath) throw new Error(`Refusing unsafe read path: ${params?.path}`);
	const file = await readSafeRepoText(cwd, safePath);
	if (!file) throw new Error(`Refusing unsafe read path: ${params?.path}`);
	const text = file.text;
	const lines = text.split("\n");
	const start = params?.offset ? Math.max(0, Number(params.offset) - 1) : 0;
	const end = params?.limit ? start + Math.max(1, Number(params.limit)) : Math.min(lines.length, start + 500);
	let out = lines.slice(start, end).join("\n");
	if (!params?.limit && end < lines.length) out += `\n\n[Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.]`;
	return { content: [{ type: "text", text: out }], details: { precogCacheHit: false } };
}

async function fallbackBash(cwd: string, params: any) {
	const timeout = Math.max(1, Number(params?.timeout ?? 30)) * 1000;
	const { stdout, stderr } = await execAsync(String(params?.command ?? ""), { cwd, timeout, maxBuffer: 256 * 1024 });
	const text = `${stdout}${stderr}`.trim() || "(no output)";
	return { content: [{ type: "text", text }], details: { precogCacheHit: false } };
}

async function fallbackGrep(cwd: string, params: any) {
	const safePath = safeRepoQueryPath(cwd, String(params?.path ?? "."));
	if (!safePath) throw new Error(`Refusing unsafe grep path: ${params?.path}`);
	const args = ["--line-number", "--color=never"];
	if (params?.ignoreCase) args.push("--ignore-case");
	if (params?.literal) args.push("--fixed-strings");
	if (params?.glob) args.push("--glob", String(params.glob));
	args.push("--", String(params?.pattern ?? ""), safePath);
	try {
		const { stdout } = await execAsync(`rg ${shellQuoteArgs(args)}`, { cwd, timeout: 30_000, maxBuffer: 256 * 1024 });
		return { content: [{ type: "text", text: stdout.trim() || "No matches found" }], details: { precogCacheHit: false } };
	} catch (err: any) {
		if (err?.code === 1) return { content: [{ type: "text", text: "No matches found" }], details: { precogCacheHit: false } };
		throw err;
	}
}

function safeRepoQueryPath(cwd: string, path: string): string | undefined {
	const raw = String(path || ".").trim();
	if (!raw || raw === ".") return ".";
	if (raw.startsWith("/")) {
		const root = resolve(cwd);
		const absolute = resolve(raw);
		if (absolute !== root && !absolute.startsWith(root + sep)) return undefined;
		const rel = relative(root, absolute).split(sep).join("/");
		return resolveSafeRepoPath(cwd, rel)?.relative;
	}
	return resolveSafeRepoPath(cwd, raw)?.relative;
}

function shellQuoteArgs(args: string[]): string {
	return args.map((arg) => `'${String(arg).replace(/'/g, "'\\''")}'`).join(" ");
}
