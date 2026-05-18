import type { PrecogEvidence } from "./core.ts";

export interface FutureClassDefinition {
	key: string;
	label: string;
	kind: "read" | "command" | "tool";
	intentTags: string[];
	tools?: string[];
	match(evidence: PrecogEvidence): boolean;
	describe(evidence: PrecogEvidence): string;
}

const FUTURE_CLASSES: FutureClassDefinition[] = [];

export function registerFutureClass(definition: FutureClassDefinition): void {
	if (!definition.key || FUTURE_CLASSES.some((item) => item.key === definition.key)) return;
	FUTURE_CLASSES.push(definition);
}

export function listFutureClasses(): readonly FutureClassDefinition[] {
	return FUTURE_CLASSES;
}

export function composeFutures(evidence: PrecogEvidence | undefined): Array<{ key: string; label: string; kind: string; description: string }> {
	if (!evidence) return [];
	return FUTURE_CLASSES
		.filter((definition) => definition.match(evidence))
		.map((definition) => ({ key: definition.key, label: definition.label, kind: definition.kind, description: definition.describe(evidence) }));
}

export function registerBuiltinFutureClasses(): void {
	registerFutureClass({
		key: "pi_blitz:edit",
		label: "pi_blitz edit",
		kind: "tool",
		intentTags: ["debug", "review"],
		tools: ["pi_blitz_edit", "pi_blitz_replace_body_span", "pi_blitz_replace_return"],
		match: (evidence) => evidence.refs.some((path) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/.test(path)) && evidence.intentTags.some((tag) => ["debug", "review"].includes(tag)),
		describe: (evidence) => `likely symbolic edit over ${evidence.refs.slice(0, 3).join(", ") || "repo symbols"}`,
	});
	registerFutureClass({
		key: "pi_blitz:batch",
		label: "pi_blitz batch/apply",
		kind: "tool",
		intentTags: ["build", "debug"],
		tools: ["pi_blitz_batch", "pi_blitz_apply", "pi_blitz_multi_body"],
		match: (evidence) => evidence.refs.filter((path) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/.test(path)).length >= 2 || evidence.changed.length >= 2,
		describe: (evidence) => `multi-file symbolic refactor candidate across ${[...evidence.refs, ...evidence.changed].slice(0, 4).join(", ")}`,
	});
}

registerBuiltinFutureClasses();
