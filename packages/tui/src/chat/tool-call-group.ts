/**
 * Groups an uninterrupted run of built-in tool calls into one transcript card.
 *
 * The card shows the latest call summary plus the number of extra calls. Ctrl+X
 * expands it to one row per call. Grouping is display-only: every call and
 * result stays in the session and in the model context.
 */
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { Text } from "../components/text";
import { isFramedBlockComponent } from "../render/output-block";
import { theme } from "../theme";
import { Container, type Component } from "../tui";
import { replaceTabs, truncateToWidth } from "../utils";
import { toolRenderers } from "../tools";
import type { ToolExecutionHandle } from "./tool-execution";

/** Built-in tool names with a TUI renderer; extensions may re-register these. */
const BUILTIN_RENDERED_TOOLS = new Set(Object.keys(toolRenderers));

/** A built-in tool joins a run; `read` keeps its own group. */
export function shouldGroupToolCall(toolName: string, isBuiltIn: boolean): boolean {
	return toolName !== "read" && (isBuiltIn || BUILTIN_RENDERED_TOOLS.has(toolName));
}

/**
 * Assistant text or an image ends a tool run. Thinking does not: it is collapsed
 * by default, so it must not split a visible run of calls.
 */
export function messageBreaksToolGroup(message: { content: ReadonlyArray<{ type: string; text?: string }> }): boolean {
	return message.content.some(
		part => part.type === "image" || (part.type === "text" && (part.text ?? "").trim().length > 0),
	);
}

type EntryStatus = "pending" | "success" | "error";

interface GroupEntry {
	toolCallId: string;
	toolName: string;
	summary: string;
	status: EntryStatus;
	errorText?: string;
	args?: unknown;
	result?: ResultShape;
}

interface ResultShape {
	content?: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

export interface ToolCallGroupOptions {
	/** Resolve the live tool definition for its custom call renderer. */
	resolveTool?: (name: string) => AgentTool | undefined;
}

const SUMMARY_WIDTH = 400;
const MAX_ERROR_WIDTH = 160;

/**
 * Build a one-line call summary. A custom extension `renderCall` wins, so its
 * format stays in the group; otherwise a short built-in summary is used.
 */
export function summarizeToolCall(toolName: string, args: unknown, tool: AgentTool | undefined): string {
	const custom = renderCustomCall(tool, args);
	if (custom) return custom;
	return builtInSummary(toolName, args);
}

function renderCustomCall(tool: AgentTool | undefined, args: unknown): string | undefined {
	if (typeof tool?.renderCall !== "function") return undefined;
	try {
		const rendered = tool.renderCall(args as never, { expanded: false, isPartial: false } as never, theme as never);
		if (!rendered || typeof (rendered as Component).render !== "function") return undefined;
		// A framed card's first row is its border, not a summary.
		if (isFramedBlockComponent(rendered as Component)) return undefined;
		const line = (rendered as Component).render(SUMMARY_WIDTH).find(row => row.trim().length > 0);
		return line ? truncateToWidth(replaceTabs(line.trim()), SUMMARY_WIDTH) : undefined;
	} catch {
		return undefined;
	}
}

/** Render a result through the tool's own renderer; output staging stays renderer-owned. */
function renderResultComponent(
	tool: AgentTool | undefined,
	result: ResultShape | undefined,
	args: unknown,
): Component | undefined {
	if (!result || typeof tool?.renderResult !== "function") return undefined;
	try {
		// Extension renderers take a trailing `args` the base AgentTool type omits.
		const renderer = tool.renderResult as
			| ((result: unknown, options: unknown, theme: unknown, args?: unknown) => unknown)
			| undefined;
		const rendered = renderer?.call(tool, result, { expanded: true, isPartial: false }, theme, args);
		return rendered && typeof (rendered as Component).render === "function" ? (rendered as Component) : undefined;
	} catch {
		return undefined;
	}
}

function firstString(args: unknown, keys: readonly string[]): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	const record = args as Record<string, unknown>;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.replace(/\s+/g, " ").trim();
		}
	}
	return undefined;
}

function builtInSummary(toolName: string, args: unknown): string {
	const path = firstString(args, ["path", "file_path", "filePath"]);
	switch (toolName) {
		case "bash": {
			const command = firstString(args, ["command"]);
			return command ? `$ ${command}` : "$";
		}
		case "grep": {
			const pattern = firstString(args, ["pattern"]);
			return `Grep ${pattern ?? ""}${path ? ` · ${path}` : ""}`.trim();
		}
		case "glob": {
			const pattern = firstString(args, ["pattern"]);
			return `Glob ${pattern ?? ""}${path ? ` · ${path}` : ""}`.trim();
		}
		case "find": {
			const query = firstString(args, ["query"]);
			return `Find "${query ?? ""}"${path ? ` · ${path}` : ""}`.trim();
		}
		case "write":
		case "edit":
			return `${toolName === "write" ? "Write" : "Edit"} ${path ?? ""}`.trim();
		case "eval":
			return `Eval ${firstString(args, ["title"]) ?? ""}`.trim();
		case "task": {
			const agent = firstString(args, ["agent"]);
			return agent ? `Task: ${agent}` : "Task";
		}
		default: {
			const primary = firstString(args, ["path", "command", "pattern", "query", "url", "name", "title"]);
			return primary ? `${toolName} ${primary}` : toolName;
		}
	}
}

function firstTextLine(result: ResultShape): string | undefined {
	const text = result.content?.find(part => part.type === "text" && typeof part.text === "string")?.text;
	const line = text?.split("\n").find(row => row.trim().length > 0);
	if (!line) return undefined;
	return truncateToWidth(replaceTabs(sanitizeText(line.trim())), MAX_ERROR_WIDTH);
}

export class ToolCallGroupComponent extends Container implements ToolExecutionHandle {
	#entries = new Map<string, GroupEntry>();
	#outputExpanded = false;
	#expanded = false;
	#toolActivityVisible = true;
	#finalized = false;
	#sealed = false;
	#blockVersion = 0;
	readonly #options: ToolCallGroupOptions;

	constructor(options: ToolCallGroupOptions = {}) {
		super();
		this.#options = options;
		this.#updateDisplay();
	}

	override render(width: number): readonly string[] {
		if (!this.#toolActivityVisible) return [];
		return super.render(width);
	}

	isTranscriptBlockFinalized(): boolean {
		if (this.#sealed) return true;
		if (!this.#finalized) return false;
		return !this.#hasPendingEntries();
	}

	#hasPendingEntries(): boolean {
		for (const entry of this.#entries.values()) {
			if (entry.status === "pending") return true;
		}
		return false;
	}

	finalize(): void {
		this.#finalized = true;
	}

	seal(): void {
		if (!this.#sealed) this.#blockVersion++;
		this.#sealed = true;
	}

	parkAsBackground(): void {}

	getTranscriptBlockVersion(): number {
		return this.#blockVersion;
	}

	/** Add one call to the run and refresh the card in place. */
	beginCall(toolName: string, args: unknown, toolCallId: string): void {
		if (!toolCallId) return;
		const entry: GroupEntry = this.#entries.get(toolCallId) ?? {
			toolCallId,
			toolName,
			summary: toolName,
			status: "pending",
		};
		entry.toolName = toolName;
		entry.args = args;
		entry.summary = summarizeToolCall(toolName, args, this.#options.resolveTool?.(toolName));
		entry.status = "pending";
		entry.errorText = undefined;
		this.#entries.set(toolCallId, entry);
		this.#updateDisplay();
	}

	updateArgs(args: unknown, toolCallId?: string): void {
		if (!toolCallId) return;
		const entry = this.#entries.get(toolCallId);
		if (!entry) {
			this.beginCall("tool", args, toolCallId);
			return;
		}
		entry.summary = summarizeToolCall(entry.toolName, args, this.#options.resolveTool?.(entry.toolName));
		entry.args = args;
		this.#updateDisplay();
	}

	/** Re-key an entry whose streamed call id changed mid-stream. */
	renameEntry(oldId: string, newId: string): void {
		if (oldId === newId || !newId) return;
		const entry = this.#entries.get(oldId);
		if (!entry || this.#entries.has(newId)) return;
		entry.toolCallId = newId;
		const reordered = [...this.#entries].map(([key, value]): [string, GroupEntry] => [
			key === oldId ? newId : key,
			value,
		]);
		this.#entries.clear();
		for (const [key, value] of reordered) this.#entries.set(key, value);
		this.#updateDisplay();
	}

	/** Remove one call without discarding its successful siblings. */
	removeEntry(toolCallId: string): boolean {
		if (!this.#entries.delete(toolCallId)) return this.#entries.size === 0;
		this.#updateDisplay();
		return this.#entries.size === 0;
	}

	updateResult(result: ResultShape, _isPartial = false, toolCallId?: string): void {
		if (!toolCallId) return;
		const entry = this.#entries.get(toolCallId);
		if (!entry) return;
		entry.status = result.isError ? "error" : "success";
		entry.errorText = result.isError ? firstTextLine(result) : undefined;
		entry.result = result;
		this.#blockVersion++;
		this.#updateDisplay();
	}

	setArgsComplete(_toolCallId?: string): void {}

	setExecutionStarted(_toolCallId?: string): void {}

	/**
	 * The host's Ctrl+O tool-output flag: on, entries render their result through
	 * the tool's renderer after their summary line. Group rows use
	 * `setGroupExpanded` (app.tools.toggleGroupExpansion).
	 */
	setExpanded(expanded: boolean): void {
		if (this.#outputExpanded === expanded) return;
		this.#outputExpanded = expanded;
		this.#blockVersion++;
		this.#updateDisplay();
	}

	setGroupExpanded(expanded: boolean): void {
		if (this.#expanded !== expanded) this.#blockVersion++;
		this.#expanded = expanded;
		this.#updateDisplay();
	}

	setToolActivityVisible(visible: boolean): void {
		if (this.#toolActivityVisible === visible) return;
		this.#toolActivityVisible = visible;
		super.invalidate();
	}

	#updateDisplay(): void {
		const entries = [...this.#entries.values()];
		const children: Component[] = [];
		if (entries.length > 0) {
			if (this.#expanded) {
				for (const entry of entries) {
					children.push(new Text(this.#entryLine(entry), 0, 0));
					if (this.#outputExpanded) {
						const result = renderResultComponent(
							this.#options.resolveTool?.(entry.toolName),
							entry.result,
							entry.args,
						);
						if (result) children.push(result);
					}
				}
			} else {
				children.push(new Text(this.#collapsedLine(entries), 0, 0));
				if (this.#outputExpanded) {
					const latest = entries[entries.length - 1]!;
					const result = renderResultComponent(
						this.#options.resolveTool?.(latest.toolName),
						latest.result,
						latest.args,
					);
					if (result) children.push(result);
				}
			}
		}
		this.clear();
		for (const child of children) this.addChild(child);
	}

	#collapsedLine(entries: readonly GroupEntry[]): string {
		const latest = entries[entries.length - 1]!;
		const extra = entries.length - 1;
		const count = extra > 0 ? ` ${theme.fg("dim", `+${extra}`)}` : "";
		const failed = entries.some(entry => entry.status === "error") ? theme.fg("error", " ✗") : "";
		return ` ${theme.fg("dim", latest.summary)}${count}${failed}`;
	}

	#entryLine(entry: GroupEntry): string {
		const summary = ` ${theme.fg(entry.status === "error" ? "error" : "dim", entry.summary)}`;
		if (entry.status !== "error") return summary;
		const detail = entry.errorText ? ` ${theme.fg("error", `— ${entry.errorText}`)}` : "";
		return `${summary}${theme.fg("error", " ✗")}${detail}`;
	}
}
