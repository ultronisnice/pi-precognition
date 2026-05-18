import { registerFutureClass } from "../../src/future-compose.ts";

registerFutureClass({
	key: "docs:markdown-preview",
	label: "Markdown preview future",
	kind: "command",
	intentTags: ["docs"],
	match: (evidence) => evidence.refs.some((path) => path.endsWith(".md")) || evidence.intentTags.includes("docs"),
	describe: (evidence) => `preview docs touched by ${evidence.refs.filter((path) => path.endsWith(".md")).join(", ") || "draft"}`,
});
