/**
 * Groups an uninterrupted run of built-in tool calls into one transcript card.
 *
 * The card shows the latest call summary plus the number of extra calls. The
 * group expansion action reveals one row per call. Grouping is display-only: every call and
 * result stays in the session and in the model context.
 */
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import type { Usage } from "@oh-my-pi/pi-ai";
import { sanitizeText } from "@oh-my-pi/pi-utils";
import { withHidden } from "../native/describe";
import type { DescribeContext, NativeNode } from "../native/node";
import { Text } from "../components/text";
import { formatUsageRow } from "../overlays/usage-row";
import { WidthAwareText } from "../render/width-aware-text";
import { isFramedBlockComponent } from "../render/output-block";
import { theme } from "../theme";
import { type Component, Container } from "../tui";
import { replaceTabs, sliceByColumn, truncateToWidth, visibleWidth } from "../utils";
import {
	ToolExecutionComponent,
	type ToolExecutionHandle,
	type ToolExecutionUi,
	type ToolResultFrame,
	toolRenderName,
} from "./tool-execution";

/** Only built-in tools join a run, even if an extension uses a built-in name. */
export function shouldGroupToolCall(_toolName: string, isBuiltIn: boolean): boolean {
	return isBuiltIn;
}

type EntryStatus = "pending" | "success" | "error";

interface GroupEntry {
	toolCallId: string;
	toolName: string;
	summary: string;
	status: EntryStatus;
	sealed?: boolean;
	errorText?: string;
	args?: unknown;
	result?: ToolResultFrame;
	renderer?: ToolExecutionComponent;
	rendererVersion?: number;
}

interface GroupUsageRow {
	anchor: string;
	toolCallIds: string[];
	usage: Usage;
	durationMs?: number;
	ttftMs?: number;
	timestamp?: number;
	turnElapsedMs?: number;
}

export interface ToolCallGroupOptions {
	/** Resolve the live tool definition for its custom call renderer. */
	resolveTool?: (name: string) => AgentTool | undefined;
	/** Host context shared with ordinary tool cards. */
	ui?: ToolExecutionUi;
	cwd?: string;
	showImages?: boolean;
	showReadImages?: boolean;
	showReadContentPreview?: boolean;
}

const SUMMARY_WIDTH = 400;
const MAX_ERROR_WIDTH = 160;

const DEFAULT_UI: ToolExecutionUi = {
	requestRender() {},
	requestComponentRender() {},
	resetDisplay() {},
};

/** Fit a summary into one row, reserving the count and failure suffix. */
function summaryLine(summary: string, suffix: string, width: number): string {
	const suffixWidth = visibleWidth(suffix);
	if (suffixWidth >= width) return sliceByColumn(suffix, suffixWidth - width, width);
	return truncateToWidth(summary, width - suffixWidth) + suffix;
}

/**
 * Build a one-line call summary. A custom extension `renderCall` wins, so its
 * format stays in the group; otherwise a short built-in summary is used.
 */
export function summarizeToolCall(toolName: string, args: unknown, tool: AgentTool | undefined): string {
	if (toolName === "read") return builtInSummary(toolName, args);
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
		case "read":
			return `Read ${sanitizeText(path ?? "")}`.trim();
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

/** Extract a short failure detail for the expanded summary. */
function firstTextLine(result: ToolResultFrame): string | undefined {
	const text = result.content?.find(part => part.type === "text" && typeof part.text === "string")?.text;
	const line = text?.split("\n").find(row => row.trim().length > 0);
	if (!line) return undefined;
	return truncateToWidth(replaceTabs(sanitizeText(line.trim())), MAX_ERROR_WIDTH);
}

export class ToolCallGroupComponent extends Container implements ToolExecutionHandle {
	#entries = new Map<string, GroupEntry>();
	#usageRows: GroupUsageRow[] = [];
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

	/** Hide the native layout without unmounting its retained children. */
	override describe(cx: DescribeContext): NativeNode | null {
		const described = super.describe(cx);
		return described ? withHidden(described, !this.#toolActivityVisible) : null;
	}

	/** Keep result images and figures mutable until their render work finishes. */
	isTranscriptBlockPending(): boolean {
		return (
			this.#toolActivityVisible &&
			this.children.some(child => child instanceof ToolExecutionComponent && child.isTranscriptBlockPending())
		);
	}

	/** Release every cached result, including those outside the visible rows. */
	override dispose(): void {
		for (const entry of this.#entries.values()) entry.renderer?.dispose();
		this.clear();
	}

	isTranscriptBlockFinalized(): boolean {
		if (this.#sealed) return true;
		if (!this.#finalized) return false;
		return !this.#hasPendingEntries();
	}

	#hasPendingEntries(): boolean {
		for (const entry of this.#entries.values()) {
			if (entry.status === "pending" && !entry.sealed) return true;
		}
		return false;
	}

	finalize(): void {
		this.#finalized = true;
	}

	/** Seal a cancelled call independently, or close the complete run. */
	seal(toolCallId?: string): void {
		if (toolCallId !== undefined) {
			const entry = this.#entries.get(toolCallId);
			if (!entry || entry.sealed) return;
			entry.sealed = true;
			entry.renderer?.seal();
			this.#blockVersion++;
			return;
		}
		if (!this.#sealed) this.#blockVersion++;
		this.#sealed = true;
		for (const entry of this.#entries.values()) entry.renderer?.seal();
	}

	parkAsBackground(): void {}

	/** Include async image and figure changes owned by mounted result components. */
	getTranscriptBlockVersion(): number {
		for (const entry of this.#entries.values()) {
			const version = entry.renderer?.getTranscriptBlockVersion();
			if (entry.rendererVersion === version) continue;
			entry.rendererVersion = version;
			this.#blockVersion++;
		}
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
		entry.renderer?.dispose();
		entry.renderer = undefined;
		entry.result = undefined;
		entry.sealed = false;
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
		entry.renderer?.updateArgs(args);
		this.#updateDisplay();
	}

	/** Re-key an entry whose streamed call id changed mid-stream. */
	renameEntry(oldId: string, newId: string): void {
		if (oldId === newId || !newId) return;
		const entry = this.#entries.get(oldId);
		if (!entry || this.#entries.has(newId)) return;
		entry.renderer?.dispose();
		entry.renderer = undefined;
		entry.toolCallId = newId;
		const reordered = [...this.#entries].map(([key, value]): [string, GroupEntry] => [
			key === oldId ? newId : key,
			value,
		]);
		this.#entries.clear();
		for (const [key, value] of reordered) this.#entries.set(key, value);
		for (const row of this.#usageRows) {
			row.toolCallIds = row.toolCallIds.map(id => (id === oldId ? newId : id));
			if (row.anchor === oldId) row.anchor = newId;
		}
		this.#updateDisplay();
	}

	/** Remove one call without discarding its successful siblings. */
	removeEntry(toolCallId: string): boolean {
		this.#entries.get(toolCallId)?.renderer?.dispose();
		if (!this.#entries.delete(toolCallId)) return this.#entries.size === 0;
		for (const row of this.#usageRows) {
			row.toolCallIds = row.toolCallIds.filter(id => id !== toolCallId);
			if (row.anchor === toolCallId) row.anchor = row.toolCallIds[row.toolCallIds.length - 1] ?? "";
		}
		this.#usageRows = this.#usageRows.filter(row => row.toolCallIds.length > 0);
		this.#updateDisplay();
		return this.#entries.size === 0;
	}

	/** Preserve partial progress until a terminal frame settles the call. */
	updateResult(result: ToolResultFrame, isPartial = false, toolCallId?: string): void {
		if (!toolCallId) return;
		const entry = this.#entries.get(toolCallId);
		if (!entry) return;
		entry.status = isPartial ? "pending" : result.isError ? "error" : "success";
		entry.errorText = !isPartial && result.isError ? firstTextLine(result) : undefined;
		entry.result = result;
		entry.renderer?.updateResult(result, isPartial);
		if (this.#sealed || entry.sealed) entry.renderer?.stopAnimation();
		this.#updateDisplay();
	}

	/** Attach a read-only turn's metrics to its last represented call. */
	attachUsage(
		toolCallIds: readonly string[],
		usage: Usage,
		durationMs?: number,
		ttftMs?: number,
		timestamp?: number,
		turnElapsedMs?: number,
	): boolean {
		const attached = toolCallIds.filter(id => this.#entries.has(id));
		const anchor = attached[attached.length - 1];
		if (!anchor) return false;
		const row = { anchor, toolCallIds: attached, usage, durationMs, ttftMs, timestamp, turnElapsedMs };
		const index = this.#usageRows.findIndex(existing => existing.anchor === anchor);
		if (index < 0) this.#usageRows.push(row);
		else this.#usageRows[index] = row;
		this.#updateDisplay();
		return true;
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
		this.#blockVersion++;
		super.invalidate();
	}

	/** Lazily mount the established result path without its separate call preview. */
	#resultComponent(entry: GroupEntry): ToolExecutionComponent | undefined {
		if (!entry.result) return undefined;
		if (!entry.renderer) {
			const tool = this.#options.resolveTool?.(entry.toolName);
			entry.renderer = new ToolExecutionComponent(
				toolRenderName(entry.toolName, tool),
				entry.args,
				{
					resultOnly: true,
					showImages:
						entry.toolName === "read"
							? (this.#options.showReadImages ?? this.#options.showImages)
							: this.#options.showImages,
				},
				tool,
				this.#options.ui ?? DEFAULT_UI,
				this.#options.cwd,
				entry.toolCallId,
			);
			if (entry.toolName === "read") entry.renderer.setExpanded(this.#outputExpanded);
			entry.renderer.updateResult(entry.result, entry.status === "pending");
			if (this.#sealed || entry.sealed) entry.renderer.seal();
		}
		return entry.renderer;
	}

	/** Reconcile visible rows while reusing live result components. */
	#updateDisplay(): void {
		this.#blockVersion++;
		const entries = [...this.#entries.values()];
		const latest = entries[entries.length - 1];
		this.clear();
		for (const entry of entries) {
			const visible = this.#expanded || entry === latest;
			const showResult = this.#outputExpanded || (entry.toolName === "read" && this.#options.showReadContentPreview);
			if (!visible || !showResult) {
				entry.renderer?.dispose();
				entry.renderer = undefined;
			}
			if (!visible) continue;
			this.addChild(
				new WidthAwareText(
					width => (this.#expanded ? this.#entryLine(entry, width) : this.#collapsedLine(entries, width)),
					0,
					0,
				),
			);
			if (showResult) {
				const result = this.#resultComponent(entry);
				if (entry.toolName === "read") result?.setExpanded(this.#outputExpanded);
				if (result) this.addChild(result);
			}
			const rows = this.#expanded ? this.#usageRows.filter(row => row.anchor === entry.toolCallId) : this.#usageRows;
			for (const row of rows) {
				this.addChild(
					new Text(
						theme.fg(
							"dim",
							`   ${formatUsageRow(row.usage, row.durationMs, row.ttftMs, row.timestamp, row.turnElapsedMs)}`,
						),
						0,
						0,
					),
				);
			}
		}
	}

	/** Preserve the hidden-call count and failure marker at narrow widths. */
	#collapsedLine(entries: readonly GroupEntry[], width: number): string {
		const latest = entries[entries.length - 1]!;
		const extra = entries.length - 1;
		const count = extra > 0 ? ` ${theme.fg("dim", `+${extra}`)}` : "";
		const failed = entries.some(entry => entry.status === "error") ? theme.fg("error", " ✗") : "";
		return summaryLine(` ${theme.fg("dim", latest.summary)}`, count + failed, width);
	}

	/** Limit only the call summary, never its renderer's result rows. */
	#entryLine(entry: GroupEntry, width: number): string {
		const summary = ` ${theme.fg(entry.status === "error" ? "error" : "dim", entry.summary)}`;
		if (entry.status !== "error") return summaryLine(summary, "", width);
		const detail = entry.errorText ? ` ${theme.fg("error", `— ${entry.errorText}`)}` : "";
		return summaryLine(summary + detail, theme.fg("error", " ✗"), width);
	}
}
