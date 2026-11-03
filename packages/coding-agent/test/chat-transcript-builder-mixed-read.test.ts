import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { setKeybindings } from "@oh-my-pi/pi-tui";
import { KeybindingsManager } from "@oh-my-pi/pi-tui/app-keybindings";
import type { AssistantMessage, ToolCall } from "@oh-my-pi/pi-ai";
import { ChatTranscriptBuilder } from "@oh-my-pi/pi-tui/chat/chat-transcript-builder";
import {
	chatTranscriptDisplayPreferences,
	setChatTranscriptDisplayPreferences,
} from "@oh-my-pi/pi-tui/chat/display-preferences";
import { ReadToolGroupComponent } from "@oh-my-pi/pi-tui/chat/read-tool-group";
import { ToolCallGroupComponent } from "@oh-my-pi/pi-tui/chat/tool-call-group";
import { stopSharedSpinnerTicker } from "@oh-my-pi/pi-tui/chat/tool-execution";
import type { SessionMessageEntryLike } from "@oh-my-pi/pi-tui/chat/transcript-entry";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { createInteractiveModeContext } from "./helpers/interactive-mode-context";

/** Create an assistant turn with the supplied content. */
function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		stopReason: "stop",
		timestamp: 1,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}
/** Create a tool call for a transcript turn. */
function call(id: string, name: string, args: Record<string, unknown>): ToolCall {
	return { type: "toolCall", id, name, arguments: args };
}
/** Create a text result for a tool call. */
function result(id: string, name: string, text: string, isError = false): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: name,
		content: [{ type: "text", text }],
		isError,
		timestamp: 2,
	};
}
/** Wrap messages in a linked session history. */
function entries(messages: AgentMessage[]): SessionMessageEntryLike[] {
	return messages.map((message, index) => ({
		type: "message",
		id: `m${index}`,
		parentId: index ? `m${index - 1}` : null,
		timestamp: "2026-01-01T00:00:00Z",
		message,
	}));
}
const builders: ChatTranscriptBuilder[] = [];
let preferences = { ...chatTranscriptDisplayPreferences };
/** Create a builder registered for test cleanup. */
function builder(isBuiltInTool?: (name: string) => boolean): ChatTranscriptBuilder {
	const context = createInteractiveModeContext();
	const value = new ChatTranscriptBuilder({ ui: context.ui, cwd: process.cwd(), requestRender() {}, isBuiltInTool });
	builders.push(value);
	return value;
}
/** Render a tool group as plain text. */
function rendered(group: ToolCallGroupComponent): string {
	return Bun.stripANSI(group.render(120).join("\n"));
}
beforeAll(async () => {
	await initTheme();
});
beforeEach(() => {
	preferences = { ...chatTranscriptDisplayPreferences };
	setChatTranscriptDisplayPreferences({
		groupConsecutiveTools: true,
		hideToolActivity: false,
		showTokenUsage: false,
		readToolResultPreview: true,
	});
	setKeybindings(KeybindingsManager.inMemory());
});
afterEach(() => {
	for (const value of builders.splice(0)) value.dispose();
	stopSharedSpinnerTicker();
	setChatTranscriptDisplayPreferences(preferences);
});

describe("transcript builder mixed read grouping", () => {
	it("retains mixed calls and a late failed internal read in its original group", () => {
		const history = entries([
			assistant([
				call("find", "find", { query: "needle" }),
				call("read", "read", { path: "skill://example" }),
				call("grep", "grep", { pattern: "other" }),
			]),
			result("find", "find", "found"),
			result("grep", "grep", "matched"),
			assistant([{ type: "text", text: "boundary" }, call("next", "find", { query: "later" })]),
			result("read", "read", "read failed", true),
			result("next", "find", "next result"),
		]);
		for (const incremental of [false, true]) {
			const value = builder();
			if (incremental) for (const entry of history) value.append([entry]);
			else value.rebuild(history);
			const groups = value.container.children.filter(child => child instanceof ToolCallGroupComponent);
			expect(groups).toHaveLength(2);
			value.setGroupExpanded(true);
			value.setExpanded(true);
			const first = rendered(groups[0]!);
			expect(first).toContain("needle");
			expect(first).toContain("skill://example");
			expect(first).toContain("other");
			expect(first).toContain("read failed");
			expect(first).not.toContain("later");
			expect(value.componentsForEntry("m4")).toContain(groups[0]!);
		}
	});

	it("keeps the compact read path when grouping is disabled", () => {
		setChatTranscriptDisplayPreferences({ groupConsecutiveTools: false });
		const value = builder();
		value.rebuild(
			entries([assistant([call("read", "read", { path: "file.txt" })]), result("read", "read", "file contents")]),
		);
		expect(value.container.children.some(child => child instanceof ReadToolGroupComponent)).toBe(true);
		expect(value.container.children.some(child => child instanceof ToolCallGroupComponent)).toBe(false);
	});

	it("keeps read-only turn usage inside the mixed group", () => {
		setChatTranscriptDisplayPreferences({ showTokenUsage: true });
		const first = assistant([call("r1", "read", { path: "first.txt" })]);
		first.usage.input = 4242;
		first.usage.totalTokens = 4242;
		const second = assistant([call("r2", "read", { path: "second.txt" })]);
		second.usage.input = 2121;
		second.usage.totalTokens = 2121;
		const history = entries([first, result("r1", "read", "first"), second, result("r2", "read", "second")]);
		for (const incremental of [false, true]) {
			const value = builder();
			if (incremental) for (const entry of history) value.append([entry]);
			else value.rebuild(history);
			const groups = value.container.children.filter(child => child instanceof ToolCallGroupComponent);
			expect(groups).toHaveLength(1);
			value.setGroupExpanded(true);
			const lines = rendered(groups[0]!).split("\n");
			const firstPath = lines.findIndex(line => line.includes("first.txt"));
			const firstUsage = lines.findIndex(line => line.includes("4.2K"));
			const secondPath = lines.findIndex(line => line.includes("second.txt"));
			const secondUsage = lines.findIndex(line => line.includes("2.1K"));
			expect(firstPath).toBeGreaterThanOrEqual(0);
			expect(firstPath).toBeLessThan(firstUsage);
			expect(firstUsage).toBeLessThan(secondPath);
			expect(secondPath).toBeLessThan(secondUsage);
			expect(
				value.container.children.filter(child => Bun.stripANSI(child.render(120).join("\n")).includes("4.2K")),
			).toEqual([groups[0]!]);
		}
	});

	it("attaches read usage to its group after an image seals it", () => {
		setChatTranscriptDisplayPreferences({ showTokenUsage: true, showImages: true });
		const turn = assistant([call("r", "read", { path: "image.png" })]);
		turn.usage.input = 4242;
		turn.usage.totalTokens = 4242;
		const history = entries([
			turn,
			{
				role: "toolResult",
				toolCallId: "r",
				toolName: "read",
				isError: false,
				timestamp: 2,
				content: [
					{
						type: "image",
						mimeType: "image/png",
						data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aL8AAAAASUVORK5CYII=",
					},
				],
			},
			assistant([call("a", "find", { query: "later" })]),
			result("a", "find", "found"),
		]);
		const value = builder();
		value.rebuild(history);
		const groups = value.container.children.filter(child => child instanceof ToolCallGroupComponent);
		expect(groups).toHaveLength(2);
		expect(rendered(groups[0]!)).toContain("4.2K");
		expect(
			value.container.children.filter(child => Bun.stripANSI(child.render(120).join("\n")).includes("4.2K")),
		).toEqual([groups[0]!]);
	});

	it("ends the current run at a read image but not at a late image from an older run", () => {
		setChatTranscriptDisplayPreferences({ showImages: true });
		const image: AgentMessage = {
			role: "toolResult",
			toolCallId: "r",
			toolName: "read",
			isError: false,
			timestamp: 2,
			content: [
				{
					type: "image",
					mimeType: "image/png",
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aL8AAAAASUVORK5CYII=",
				},
			],
		};
		const first = builder();
		first.rebuild(
			entries([
				assistant([call("r", "read", { path: "image.png" })]),
				image,
				assistant([call("a", "find", { query: "after image" })]),
				result("a", "find", "found"),
			]),
		);
		expect(first.container.children.filter(child => child instanceof ToolCallGroupComponent)).toHaveLength(2);

		const late = builder();
		late.rebuild(
			entries([
				assistant([call("r", "read", { path: "image.png" })]),
				assistant([{ type: "text", text: "boundary" }, call("a", "find", { query: "before late image" })]),
				image,
				assistant([call("b", "grep", { pattern: "after late image" })]),
				result("a", "find", "found"),
				result("b", "grep", "matched"),
			]),
		);
		const groups = late.container.children.filter(child => child instanceof ToolCallGroupComponent);
		expect(groups).toHaveLength(2);
		late.setGroupExpanded(true);
		expect(rendered(groups[1]!)).toContain("before late image");
		expect(rendered(groups[1]!)).toContain("after late image");
	});

	it("keeps calls together across a non-read image result", () => {
		setChatTranscriptDisplayPreferences({ showImages: true });
		const history = entries([
			assistant([call("a", "find", { query: "before image" })]),
			{
				role: "toolResult",
				toolCallId: "a",
				toolName: "find",
				isError: false,
				timestamp: 2,
				content: [
					{
						type: "image",
						mimeType: "image/png",
						data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aL8AAAAASUVORK5CYII=",
					},
				],
			},
			assistant([call("b", "read", { path: "after-image.txt" })]),
			result("b", "read", "file contents"),
		]);
		for (const incremental of [false, true]) {
			const value = builder();
			if (incremental) for (const entry of history) value.append([entry]);
			else value.rebuild(history);
			const groups = value.container.children.filter(child => child instanceof ToolCallGroupComponent);
			expect(groups).toHaveLength(1);
			value.setGroupExpanded(true);
			expect(rendered(groups[0]!)).toContain("before image");
			expect(rendered(groups[0]!)).toContain("after-image.txt");
		}
	});

	it("keeps an extension read outside built-in groups", () => {
		const value = builder(name => name !== "read");
		value.rebuild(
			entries([
				assistant([
					call("a", "find", { query: "before" }),
					call("r", "read", { path: "extension.txt" }),
					call("b", "find", { query: "after" }),
				]),
				result("a", "find", "a"),
				result("r", "read", "r"),
				result("b", "find", "b"),
			]),
		);
		const groups = value.container.children.filter(child => child instanceof ToolCallGroupComponent);
		expect(groups).toHaveLength(2);
		expect(rendered(groups[0]!)).toContain("before");
		expect(rendered(groups[1]!)).toContain("after");
	});
});
