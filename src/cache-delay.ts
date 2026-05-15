/**
 * Dot 4 — Cache-invariant micro-delay.
 *
 * Cache-invariant latency-shaping for served futures.
 *
 * Finding (validated at n=5 + n=10): when a cached tool returns instantly
 * (μs), the model USES IT MORE. Cheap diagnostics seduce the model into
 * exploration patterns it wouldn't take if the tool felt expensive. The
 * cache changes behavior, not just latency.
 *
 * The cure: shape the served latency so cache hits MATCH cold-call latency.
 * The model sees a uniform tool-latency distribution, so its tool-selection
 * policy is unchanged by the cache's presence. The runtime gets the
 * operator-time work savings without warping behavior.
 *
 * This replaced the content-aware "mutation verb regex" patch. It's the
 * model-blind cure for the diagnostic-seduction problem.
 *
 * Defaults (chosen to match observed cold-tool latency for each class):
 *   read: 5ms     — close to a cold fs read
 *   grep: 80ms    — close to a cold rg invocation
 *   bash: 750ms   — close to a typical npm test / typecheck / lint
 *
 * Override per-class:
 *   PI_PRECOG_CACHE_DELAY_READ_MS=10
 *   PI_PRECOG_CACHE_DELAY_BASH_MS=600
 *   PI_PRECOG_CACHE_DELAY_GREP_MS=120
 *
 * Override globally (overrides per-class defaults but not per-class env):
 *   PI_PRECOG_CACHE_DELAY_MS=100
 *
 * Disable entirely (returns the warmed result instantly — recovers the
 * "raw speedup" mode for bench/diagnostic use):
 *   PI_PRECOG_CACHE_DELAY_MS=0
 */

export type CacheTool = "read" | "bash" | "grep";

/**
 * Default delay per tool class — designed to make cache hits feel like
 * cold tool calls so the model's tool-selection policy is unchanged.
 */
const DEFAULT_DELAY_MS: Record<CacheTool, number> = {
	read: 5,
	grep: 80,
	bash: 750,
};

export function cacheDelayMs(tool: CacheTool): number {
	const perClass = process.env[`PI_PRECOG_CACHE_DELAY_${tool.toUpperCase()}_MS`];
	if (perClass !== undefined) {
		const n = Number(perClass);
		if (Number.isFinite(n) && n >= 0) return n;
	}
	const global = process.env.PI_PRECOG_CACHE_DELAY_MS;
	if (global !== undefined) {
		const n = Number(global);
		if (Number.isFinite(n) && n >= 0) return n;
	}
	return DEFAULT_DELAY_MS[tool];
}

export async function applyCacheDelay(tool: CacheTool): Promise<void> {
	const ms = cacheDelayMs(tool);
	if (ms <= 0) return;
	await new Promise<void>((resolveFn) => {
		const timer = setTimeout(resolveFn, ms);
		(timer as any).unref?.();
	});
}
