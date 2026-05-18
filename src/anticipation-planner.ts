/**
 * pi-precognition — Anticipation Planner (v0.3.1)
 *
 * The policy layer that sits between the Pattern Library (memory) and the
 * warmers (effectors). Pure functions; never blocks; never throws.
 *
 * Read the persisted library, score known patterns against the *current*
 * draft evidence (and optional mutation event), and produce an
 * AnticipationPlan that:
 *
 *   - boostedRefs    : additional refs the warmers should pull (sourced
 *                      from historically high-value patterns matching now)
 *   - armedKeys      : extra future keys to consider arming
 *                      (e.g. command futures the library knows pay off)
 *   - suppressedKeys : keys the library says are not worth warming right now
 *                      (e.g. cold patterns with high rejection ratios)
 *   - matchedPatterns: which library patterns drove the plan
 *   - reasons        : per-decision human-readable receipt strings
 *
 * The planner is *conservative*: it only boosts when historical evidence
 * says the future has paid off (hits > 0 OR savedMs > 0) and only
 * suppresses when historical rejections clearly dominate hits.
 *
 * Design rules:
 *   - Never modifies the library file. Reads only.
 *   - Never widens the candidate set without budget caps.
 *   - Every armed/suppressed item carries a `reason` for receipts.
 *   - Returns an empty plan on any failure; warming continues as before.
 */

import { performance } from "node:perf_hooks";
import type { PrecogEvidence } from "./core.ts";
import type { MutationEvent } from "./mutation-stream.ts";
import {
	loadPatternLibrary,
	type PatternFutureStats,
	type PatternLibraryFile,
	type PatternRecord,
} from "./pattern-library.ts";

export interface AnticipationPlan {
	/** Extra refs to feed into warmReadOnlyEvidence / warmGhostTools. */
	boostedRefs: string[];
	/** Extra intent tags to merge into evidence so command-future
	 * warming fires for historically paid-off commands even when the
	 * draft doesn't explicitly mention them. */
	boostedIntentTags: string[];
	/** Future keys the library says are worth arming right now. */
	armedKeys: string[];
	/** Future keys the library says are not worth arming right now. */
	suppressedKeys: string[];
	/** Patterns that drove the plan, in match-score order. */
	matchedPatterns: Array<{ id: string; label: string; score: number }>;
	/** Per-decision human-readable receipts (`key: reason`). */
	reasons: Array<[string, string]>;
	/** Wall-clock spent planning, ms. */
	elapsedMs: number;
}

export interface PlanOptions {
	/** Max refs we are willing to add on top of current evidence. Default 4. */
	maxBoostedRefs?: number;
	/** Max armed-future keys we surface. Default 6. */
	maxArmedKeys?: number;
	/** Minimum match score for a pattern to contribute. Default 0.5. */
	minMatchScore?: number;
	/** Pre-loaded library (skip disk read; used in tests / hot paths). */
	library?: PatternLibraryFile;
}

const EMPTY_PLAN: AnticipationPlan = Object.freeze({
	boostedRefs: [],
	boostedIntentTags: [],
	armedKeys: [],
	suppressedKeys: [],
	matchedPatterns: [],
	reasons: [],
	elapsedMs: 0,
}) as AnticipationPlan;

/**
 * Build an AnticipationPlan from the persisted library, current draft
 * evidence, and (optionally) the most recent mutation event.
 *
 * Never throws. Returns the empty plan when nothing matches or anything
 * fails — warmers must continue with their normal candidate set.
 */
export async function planAnticipation(
	cwd: string,
	evidence: PrecogEvidence | undefined,
	mutation?: MutationEvent,
	options: PlanOptions = {},
): Promise<AnticipationPlan> {
	const started = nowMs();
	if (!evidence) return { ...EMPTY_PLAN };
	const maxBoosted = options.maxBoostedRefs ?? 4;
	const maxArmed = options.maxArmedKeys ?? 6;
	const minScore = options.minMatchScore ?? 0.5;
	let library: PatternLibraryFile;
	try {
		library = options.library ?? (await loadPatternLibrary(cwd));
	} catch {
		return { ...EMPTY_PLAN, elapsedMs: nowMs() - started };
	}
	if (!library.patterns?.length) {
		return { ...EMPTY_PLAN, elapsedMs: nowMs() - started };
	}

	const currentRefs = new Set([...(evidence.refs ?? []), ...(evidence.changed ?? [])]);
	const currentTags = new Set(evidence.intentTags ?? []);
	const mutationFiles = new Set(mutation?.changed ?? []);

	type Scored = { pattern: PatternRecord; score: number };
	const scored: Scored[] = [];
	for (const pattern of library.patterns) {
		const score = scoreMatch(pattern, currentRefs, currentTags, mutationFiles);
		if (score >= minScore) scored.push({ pattern, score });
	}
	scored.sort((a, b) => b.score - a.score);
	const top = scored.slice(0, 6);

	const boostedRefs: string[] = [];
	const boostedIntentTags: string[] = [];
	const seenRef = new Set<string>(currentRefs);
	const seenTag = new Set<string>(currentTags);
	const armed = new Map<string, string>();
	const suppressed = new Map<string, string>();
	const reasons: Array<[string, string]> = [];

	for (const { pattern, score } of top) {
		// Refs the pattern has seen that aren't currently in evidence.
		for (const ref of pattern.refs) {
			if (boostedRefs.length >= maxBoosted) break;
			if (seenRef.has(ref)) continue;
			seenRef.add(ref);
			boostedRefs.push(ref);
			reasons.push([
				`ref:${ref}`,
				`boosted from pattern "${pattern.label}" (match ${score.toFixed(2)})`,
			]);
		}

		// Intent tags the pattern carries — inject when the pattern has
		// historical paid-off futures bound to those tags. This unlocks
		// command-future warming for tag-empty drafts.
		const hasPaidOffFuture = pattern.futures.some(
			(f) => f.hits >= 1 || f.savedMs >= 250,
		);
		if (hasPaidOffFuture) {
			for (const tag of pattern.intentTags) {
				if (seenTag.has(tag)) continue;
				seenTag.add(tag);
				boostedIntentTags.push(tag);
				reasons.push([
					`tag:${tag}`,
					`injected from pattern "${pattern.label}" (paid-off history)`,
				]);
			}
		}

		// Futures the pattern has armed before — decide arm vs suppress.
		const sortedFutures = [...pattern.futures].sort((a, b) => futureScore(b) - futureScore(a));
		for (const future of sortedFutures) {
			const verdict = decideFuture(future);
			if (verdict.action === "arm" && !armed.has(future.key) && armed.size < maxArmed) {
				armed.set(future.key, `${verdict.reason} (pattern "${pattern.label}")`);
				reasons.push([future.key, `armed: ${verdict.reason}`]);
			} else if (verdict.action === "suppress" && !suppressed.has(future.key)) {
				suppressed.set(future.key, `${verdict.reason} (pattern "${pattern.label}")`);
				reasons.push([future.key, `suppressed: ${verdict.reason}`]);
			}
		}
	}

	return {
		boostedRefs,
		boostedIntentTags,
		armedKeys: [...armed.keys()],
		suppressedKeys: [...suppressed.keys()],
		matchedPatterns: top.map(({ pattern, score }) => ({ id: pattern.id, label: pattern.label, score })),
		reasons,
		elapsedMs: nowMs() - started,
	};
}

/**
 * Merge a plan's boosted refs into existing evidence to produce an
 * augmented evidence object the warmers can consume without changes.
 * Returns the same `evidence` object when there is nothing to boost.
 */
export function applyPlanToEvidence(
	evidence: PrecogEvidence | undefined,
	plan: AnticipationPlan,
): PrecogEvidence | undefined {
	if (!evidence) return evidence;
	const hasRefs = plan.boostedRefs.length > 0;
	const hasTags = (plan.boostedIntentTags?.length ?? 0) > 0;
	if (!hasRefs && !hasTags) return evidence;

	const seenRefs = new Set([...(evidence.refs ?? []), ...(evidence.changed ?? [])]);
	const refAdditions = plan.boostedRefs.filter((ref) => !seenRefs.has(ref));

	const seenTags = new Set(evidence.intentTags ?? []);
	const tagAdditions = (plan.boostedIntentTags ?? []).filter((tag) => !seenTags.has(tag));

	if (!refAdditions.length && !tagAdditions.length) return evidence;

	return {
		...evidence,
		refs: [...(evidence.refs ?? []), ...refAdditions].slice(0, 16),
		intentTags: [...(evidence.intentTags ?? []), ...tagAdditions].slice(0, 8),
		confidence: Math.max(evidence.confidence ?? 0.25, 0.3),
	};
}

/**
 * Score a single pattern against the current signal.
 *
 *   - +1.0   per intent tag overlap
 *   - +0.5   per ref overlap (current evidence ∩ pattern.refs)
 *   - +0.75  per ref overlap (mutation files ∩ pattern.refs)
 *   - x  count × confidence (prior strength)
 *
 * Patterns with no overlap on either dimension score 0 and are dropped.
 */
function scoreMatch(
	pattern: PatternRecord,
	currentRefs: Set<string>,
	currentTags: Set<string>,
	mutationFiles: Set<string>,
): number {
	let overlap = 0;
	for (const tag of pattern.intentTags) if (currentTags.has(tag)) overlap += 1.0;
	for (const ref of pattern.refs) {
		if (currentRefs.has(ref)) overlap += 0.5;
		if (mutationFiles.has(ref)) overlap += 0.75;
	}
	if (overlap === 0) return 0;
	const prior = Math.max(0.1, pattern.count) * Math.max(0.1, pattern.confidence);
	return overlap * (1 + Math.log1p(prior) / 4);
}

/**
 * Quality of a single future: hits × value vs rejections, with savedMs as
 * a tie-breaker. Used for ordering within a pattern.
 */
function futureScore(future: PatternFutureStats): number {
	return future.hits * 2 - future.rejections + future.savedMs / 1000;
}

/**
 * Per-future arm/suppress decision based on its historical record.
 *
 *   - Strong positive (hits >= 2 OR savedMs >= 500): arm.
 *   - Strong negative (rejections > hits AND rejections >= 3): suppress.
 *   - Otherwise: leave to existing logic (no recommendation).
 */
function decideFuture(future: PatternFutureStats): { action: "arm" | "suppress" | "neutral"; reason: string } {
	if (future.hits >= 2 || future.savedMs >= 500) {
		return {
			action: "arm",
			reason: `${future.hits} prior hits, saved ${Math.round(future.savedMs)}ms`,
		};
	}
	if (future.rejections >= 3 && future.rejections > future.hits) {
		return {
			action: "suppress",
			reason: `${future.rejections} rejections vs ${future.hits} hits`,
		};
	}
	return { action: "neutral", reason: "no strong signal" };
}

function nowMs(): number {
	return performance.now();
}
