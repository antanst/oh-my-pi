import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EventController } from "@oh-my-pi/pi-coding-agent/modes/controllers/event-controller";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import { UiHelpers } from "@oh-my-pi/pi-coding-agent/modes/utils/ui-helpers";
import type { SessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import type { Component } from "@oh-my-pi/pi-tui";
import { ChatTranscriptBuilder } from "@oh-my-pi/pi-tui/chat/chat-transcript-builder";
import {
	chatTranscriptDisplayPreferences,
	setChatTranscriptDisplayPreferences,
} from "@oh-my-pi/pi-tui/chat/display-preferences";
import { shouldGroupToolCall, summarizeToolCall, ToolCallGroupComponent } from "@oh-my-pi/pi-tui/chat/tool-call-group";
import { ToolExecutionComponent } from "@oh-my-pi/pi-tui/chat/tool-execution";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { createInteractiveModeContext } from "./helpers/interactive-mode-context";

function toolCallMessage(id: string, command: string, text?: string): AssistantMessage {
	const content: AssistantMessage["content"] = [{ type: "toolCall", id, name: "bash", arguments: { command } }];
	if (text) content.push({ type: "text", text });
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		stopReason: "stop",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: Date.now(),
	};
}

function textMessage(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		stopReason: "stop",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: Date.now(),
	} as AgentMessage;
}

function toolCallWithThinking(id: string, command: string): AssistantMessage {
	const message = toolCallMessage(id, command);
	return {
		...message,
		content: [
			{ type: "thinking", thinking: "plan the next step" },
			{ type: "toolCall", id, name: "bash", arguments: { command } },
		],
	};
}

function toolResult(id: string, text: string, isError = false): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: "bash",
		content: [{ type: "text", text }],
		isError,
		timestamp: Date.now(),
	} as AgentMessage;
}

function bashTurn(id: string, command: string, output = "ok"): AgentMessage[] {
	return [toolCallMessage(id, command), toolResult(id, output)];
}

function plain(component: Component): string {
	return Bun.stripANSI(component.render(120).join("\n"));
}

describe("ToolCallGroupComponent", () => {
	beforeAll(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true });
		await initTheme();
	});

	it("joins built-in tools except read", () => {
		expect(shouldGroupToolCall("bash", true)).toBe(true);
		expect(shouldGroupToolCall("grep", true)).toBe(true);
		expect(shouldGroupToolCall("read", true)).toBe(false);
		expect(shouldGroupToolCall("bash", false)).toBe(true);
		expect(shouldGroupToolCall("custom_tool", false)).toBe(false);
	});

	it("collapses to the latest call summary with the extra-call count", () => {
		const group = new ToolCallGroupComponent();
		group.beginCall("bash", { command: "echo one" }, "c1");
		expect(plain(group)).toContain("$ echo one");
		expect(plain(group)).not.toContain("+1");
		group.beginCall("bash", { command: "echo two" }, "c2");
		expect(plain(group)).toContain("$ echo two");
		expect(plain(group)).not.toContain("$ echo one");
		expect(plain(group)).toContain("+1");
		group.seal();
	});

	it("expands to one row per call in order", () => {
		const group = new ToolCallGroupComponent();
		group.beginCall("bash", { command: "echo one" }, "c1");
		group.beginCall("grep", { pattern: "alpha", path: "src" }, "c2");
		group.setGroupExpanded(true);
		const rows = plain(group).split("\n");
		expect(rows[0]).toContain("$ echo one");
		expect(rows[1]).toContain("Grep alpha · src");
		expect(rows).toHaveLength(2);
	});

	it("ignores the host tool-output toggle", () => {
		const group = new ToolCallGroupComponent();
		group.beginCall("bash", { command: "echo one" }, "c1");
		group.beginCall("bash", { command: "echo two" }, "c2");
		group.setExpanded(true);
		expect(plain(group).split("\n")).toHaveLength(1);
		expect(plain(group)).toContain("+1");
	});

	it("expands through its own key action", () => {
		const ctx = createInteractiveModeContext();
		const controller = new InputController(ctx);
		const group = new ToolCallGroupComponent();
		group.beginCall("bash", { command: "echo one" }, "c1");
		group.beginCall("bash", { command: "echo two" }, "c2");
		ctx.chatContainer.addChild(group);

		controller.setToolsExpanded(true);
		expect(plain(group).split("\n")).toHaveLength(1);

		controller.toggleToolGroupExpansion();
		expect(ctx.toolGroupExpanded).toBe(true);
		expect(plain(group).split("\n")).toHaveLength(2);
		expect(plain(group)).toContain("$ echo one");

		controller.toggleToolGroupExpansion();
		expect(ctx.toolGroupExpanded).toBe(false);
		expect(plain(group).split("\n")).toHaveLength(1);
	});

	it("marks failed calls without hiding the error", () => {
		const group = new ToolCallGroupComponent();
		group.beginCall("bash", { command: "false" }, "c1");
		group.updateResult({ content: [{ type: "text", text: "exit code 1" }], isError: true }, false, "c1");
		expect(plain(group)).toContain("✗");
		group.setGroupExpanded(true);
		expect(plain(group)).toContain("exit code 1");
	});

	it("renders nothing while tool activity is hidden", () => {
		const group = new ToolCallGroupComponent();
		group.beginCall("bash", { command: "echo one" }, "c1");
		group.setToolActivityVisible(false);
		expect(group.render(120)).toEqual([]);
	});

	it("keeps order across a rename and drops removed entries", () => {
		const group = new ToolCallGroupComponent();
		group.beginCall("bash", { command: "echo one" }, "c1");
		group.beginCall("bash", { command: "echo two" }, "c2");
		group.renameEntry("c1", "c1b");
		group.setGroupExpanded(true);
		expect(plain(group).split("\n")[0]).toContain("$ echo one");
		expect(group.removeEntry("c1b")).toBe(false);
		expect(plain(group)).toContain("$ echo two");
		expect(group.removeEntry("c2")).toBe(true);
	});

	it("attaches a late result after the run is sealed", () => {
		const group = new ToolCallGroupComponent();
		group.beginCall("bash", { command: "sleep 1" }, "c1");
		group.finalize();
		group.seal();
		group.updateResult({ content: [{ type: "text", text: "done late" }], isError: false }, false, "c1");
		expect(plain(group)).not.toContain("✗");
		group.updateResult({ content: [{ type: "text", text: "late failure" }], isError: true }, false, "c1");
		expect(plain(group)).toContain("✗");
	});

	it("uses the fallback summary when no custom renderer exists", () => {
		expect(summarizeToolCall("bash", { command: "ls -l" }, undefined)).toBe("$ ls -l");
		expect(summarizeToolCall("write", { path: "/tmp/a.ts" }, undefined)).toBe("Write /tmp/a.ts");
	});
});

describe("consecutive tool groups in transcripts", () => {
	beforeEach(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true });
		await initTheme();
	});

	afterEach(() => {
		resetSettingsForTest();
		vi.restoreAllMocks();
	});

	function replay(messages: AgentMessage[], grouped: boolean): readonly Component[] {
		const ctx = createInteractiveModeContext({
			settings: Settings.isolated(
				grouped ? { "display.groupConsecutiveTools": true } : { "display.groupConsecutiveTools": false },
			),
		});
		const helpers = new UiHelpers(ctx);
		ctx.addMessageToChat = helpers.addMessageToChat.bind(helpers);
		helpers.renderSessionContext({ messages } as SessionContext);
		return ctx.chatContainer.children;
	}

	function builderChildren(messages: AgentMessage[]): readonly Component[] {
		const builder = new ChatTranscriptBuilder({
			ui: { requestRender() {}, requestComponentRender() {} } as never,
			cwd: process.cwd(),
			requestRender() {},
		});
		builder.rebuild(
			messages.map((message, i) => ({
				type: "message" as const,
				id: `m${i}`,
				parentId: i ? `m${i - 1}` : null,
				timestamp: new Date(0).toISOString(),
				message,
			})),
		);
		return builder.container.children;
	}

	it("keeps one card per call while the setting is off", () => {
		const messages = [...bashTurn("b1", "echo one"), ...bashTurn("b2", "echo two")];
		const groups = replay(messages, false).filter(child => child instanceof ToolCallGroupComponent);
		const cards = replay(messages, false).filter(child => child instanceof ToolExecutionComponent);
		expect(groups).toHaveLength(0);
		expect(cards).toHaveLength(2);
	});

	it("renders a run of calls as one card that shows the latest call", () => {
		const messages = [...bashTurn("b1", "echo one"), ...bashTurn("b2", "echo two")];
		const children = replay(messages, true);
		const groups = children.filter(
			(child): child is ToolCallGroupComponent => child instanceof ToolCallGroupComponent,
		);
		expect(groups).toHaveLength(1);
		expect(children.filter(child => child instanceof ToolExecutionComponent)).toHaveLength(0);
		const rendered = plain(groups[0]!);
		expect(rendered).toContain("$ echo two");
		expect(rendered).toContain("+1");
	});

	it("splits the run on visible assistant text", () => {
		const messages = [...bashTurn("b1", "echo one"), textMessage("step done"), ...bashTurn("b2", "echo two")];
		const groups = replay(messages, true).filter(
			(child): child is ToolCallGroupComponent => child instanceof ToolCallGroupComponent,
		);
		expect(groups).toHaveLength(2);
	});

	it("hides grouped cards when tool activity is hidden", () => {
		const messages = [...bashTurn("b1", "echo one"), ...bashTurn("b2", "echo two")];
		const ctx = createInteractiveModeContext({
			settings: Settings.isolated({
				"display.groupConsecutiveTools": true,
				"display.hideToolActivity": true,
			}),
		});
		const helpers = new UiHelpers(ctx);
		ctx.addMessageToChat = helpers.addMessageToChat.bind(helpers);
		ctx.chatContainer.setToolActivityVisible(false);
		helpers.renderSessionContext({ messages } as SessionContext);
		const groups = ctx.chatContainer.children.filter(
			(child): child is ToolCallGroupComponent => child instanceof ToolCallGroupComponent,
		);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.render(120)).toEqual([]);
	});

	it("keeps one card when thinking blocks sit between the calls", () => {
		const messages = [
			toolCallWithThinking("b1", "echo one"),
			toolResult("b1", "one"),
			toolCallWithThinking("b2", "echo two"),
			toolResult("b2", "two"),
		];
		const groups = replay(messages, true).filter(
			(child): child is ToolCallGroupComponent => child instanceof ToolCallGroupComponent,
		);
		expect(groups).toHaveLength(1);
		expect(plain(groups[0]!)).toContain("$ echo two");
	});

	it("renders the same card in the transcript builder", () => {
		const messages = [...bashTurn("b1", "echo one"), ...bashTurn("b2", "echo two")];
		const previous = chatTranscriptDisplayPreferences.groupConsecutiveTools;
		setChatTranscriptDisplayPreferences({ groupConsecutiveTools: true });
		try {
			const fromBuilder = builderChildren(messages).filter(
				(child): child is ToolCallGroupComponent => child instanceof ToolCallGroupComponent,
			);
			const fromReplay = replay(messages, true).filter(
				(child): child is ToolCallGroupComponent => child instanceof ToolCallGroupComponent,
			);
			expect(fromBuilder).toHaveLength(1);
			expect(fromReplay).toHaveLength(1);
			expect(plain(fromBuilder[0]!)).toBe(plain(fromReplay[0]!));
		} finally {
			setChatTranscriptDisplayPreferences({ groupConsecutiveTools: previous });
		}
	});
});

describe("live tool groups in the event controller", () => {
	beforeAll(async () => {
		await initTheme(false);
	});

	beforeEach(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true });
	});

	afterEach(() => {
		resetSettingsForTest();
		vi.restoreAllMocks();
	});

	it("adds one group card for two live calls", async () => {
		const ctx = createInteractiveModeContext();
		ctx.chatContainer.setToolActivityVisible(true);
		const controller = new EventController(ctx);
		const previous = chatTranscriptDisplayPreferences.groupConsecutiveTools;
		setChatTranscriptDisplayPreferences({ groupConsecutiveTools: true });
		try {
			for (const [id, command] of [
				["c1", "echo one"],
				["c2", "echo two"],
			] as const) {
				await controller.handleEvent({
					type: "tool_execution_start",
					toolCallId: id,
					toolName: "bash",
					args: { command },
				} as never);
				await controller.handleEvent({
					type: "tool_execution_end",
					toolCallId: id,
					toolName: "bash",
					result: { content: [{ type: "text", text: "ok" }] },
					isError: false,
				} as never);
			}
			const groups = ctx.chatContainer.children.filter(
				(child): child is ToolCallGroupComponent => child instanceof ToolCallGroupComponent,
			);
			expect(groups).toHaveLength(1);
			expect(ctx.chatContainer.children.filter(child => child instanceof ToolExecutionComponent)).toHaveLength(0);
			expect(plain(groups[0]!)).toContain("$ echo two");
			expect(plain(groups[0]!)).toContain("+1");
		} finally {
			setChatTranscriptDisplayPreferences({ groupConsecutiveTools: previous });
		}
	});
});
