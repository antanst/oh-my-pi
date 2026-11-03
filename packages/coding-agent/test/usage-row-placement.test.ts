/**
 * Regression coverage for per-turn usage placement across transcript rebuilds.
 * Read-only turns keep their metrics inside the compact read group; other
 * assistant turns retain a standalone row below their visible content/tools.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ChatTranscriptBuilder } from "@oh-my-pi/pi-tui/chat/chat-transcript-builder";
import { ReadToolGroupComponent } from "@oh-my-pi/pi-tui/chat/read-tool-group";
import { ToolCallGroupComponent } from "@oh-my-pi/pi-tui/chat/tool-call-group";
import {
	chatTranscriptDisplayPreferences,
	setChatTranscriptDisplayPreferences,
} from "@oh-my-pi/pi-tui/chat/display-preferences";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { UiHelpers } from "@oh-my-pi/pi-coding-agent/modes/utils/ui-helpers";
import type { SessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import { Container, TUI } from "@oh-my-pi/pi-tui";
import { formatNumber } from "@oh-my-pi/pi-utils";
import { VirtualTerminal } from "../../tui/test/virtual-terminal";

import { cfgDisplayShowTokenUsage } from "@oh-my-pi/pi-coding-agent/modes/settings";

// 4242 → "4.2K": distinctive enough not to collide with a read group's render.
const USAGE_INPUT = 4242;
const USAGE_LABEL = formatNumber(USAGE_INPUT);
// Fixed local wall-clock time so the rendered stamp is deterministic across time zones.
// Single-digit month/day/hour/minute/second exercise the formatter's zero-padding.
const USAGE_TS = new Date(2026, 0, 2, 3, 4, 5).getTime();
const USAGE_TS_LABEL = "2026-01-02 03:04:05";
const SECOND_USAGE_TS = new Date(2026, 0, 2, 3, 4, 6).getTime();
const SECOND_USAGE_TS_LABEL = "2026-01-02 03:04:06";

function readTurn(
	toolCallId = "r1",
	filePath = "src/foo.ts",
	usageInput = USAGE_INPUT,
	timestamp = USAGE_TS,
): AgentMessage[] {
	const assistant = {
		role: "assistant",
		content: [{ type: "toolCall", id: toolCallId, name: "read", arguments: { path: filePath } }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		stopReason: "stop",
		usage: {
			input: usageInput,
			output: 7,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: usageInput + 7,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp,
	} as unknown as AgentMessage;
	const toolResult = {
		role: "toolResult",
		toolCallId,
		toolName: "read",
		content: [{ type: "text", text: "line1\nline2" }],
		timestamp,
	} as unknown as AgentMessage;
	return [assistant, toolResult];
}

function makeHarness(showTokenUsage: boolean, grouping = false): { ctx: InteractiveModeContext; helpers: UiHelpers } {
	const ctx = {
		chatContainer: new Container(),
		transcriptMessageComponents: new WeakMap(),
		pendingTools: new Map(),
		ui: { requestRender: vi.fn() },
		statusLine: { invalidate: vi.fn() },
		updateEditorBorderColor: vi.fn(),
		settings: Settings.isolated({
			"display.showTokenUsage": showTokenUsage,
			"display.groupConsecutiveTools": grouping,
		}),
		addMessageToChat: (message: AgentMessage) => helpers.addMessageToChat(message),
		session: {
			retryAttempt: 0,
			getToolByName: () => undefined,
			hasBuiltInTool: () => true,
			sessionManager: { getCwd: () => process.cwd() },
		},
		get viewSession() {
			return (this as typeof ctx).session;
		},
		toolOutputExpanded: false,
		hideThinkingBlock: false,
		clearTransientSessionUi: () => {},
	} as unknown as InteractiveModeContext;
	const helpers = new UiHelpers(ctx);
	return { ctx, helpers };
}

describe("UiHelpers.renderSessionContext token-usage row placement", () => {
	beforeAll(async () => {
		await initTheme();
	});

	it("nests the usage row inside the read group for a read-only turn", () => {
		const { ctx, helpers } = makeHarness(true);
		helpers.renderSessionContext({ messages: readTurn() } as SessionContext);

		const children = ctx.chatContainer.children;
		const group = children.find(
			(component): component is ReadToolGroupComponent => component instanceof ReadToolGroupComponent,
		);
		expect(group).toBeDefined();

		const rendered = group!.render(120).join("\n");
		expect(rendered).toContain(USAGE_LABEL);
		expect(rendered).toContain(USAGE_TS_LABEL);
		expect(children[children.length - 1]).toBe(group!);
		expect(children.filter(component => component.render(120).join("\n").includes(USAGE_LABEL))).toHaveLength(1);
	});

	it("interleaves consecutive read-only turns with their paths in one group", () => {
		const { ctx, helpers } = makeHarness(true);
		const messages = [...readTurn(), ...readTurn("r2", "src/bar.ts", 2121, SECOND_USAGE_TS)];
		helpers.renderSessionContext({ messages } as SessionContext);

		const groups = ctx.chatContainer.children.filter(
			(component): component is ReadToolGroupComponent => component instanceof ReadToolGroupComponent,
		);
		expect(groups).toHaveLength(1);
		const lines = Bun.stripANSI(groups[0]!.render(120).join("\n")).split("\n");
		const fooIndex = lines.findIndex(line => line.includes("src/foo.ts"));
		const firstUsageIndex = lines.findIndex(line => line.includes(USAGE_TS_LABEL));
		const barIndex = lines.findIndex(line => line.includes("src/bar.ts"));
		const secondUsageIndex = lines.findIndex(line => line.includes(SECOND_USAGE_TS_LABEL));
		expect(fooIndex).toBeLessThan(firstUsageIndex);
		expect(firstUsageIndex).toBeLessThan(barIndex);
		expect(barIndex).toBeLessThan(secondUsageIndex);
	});

	it("keeps grouped turn usage ordered through group and output expansion", () => {
		const { ctx, helpers } = makeHarness(true, true);
		helpers.renderSessionContext({
			messages: [...readTurn(), ...readTurn("r2", "src/bar.ts", 2121, SECOND_USAGE_TS)],
		} as SessionContext);
		const groups = ctx.chatContainer.children.filter(
			(component): component is ToolCallGroupComponent => component instanceof ToolCallGroupComponent,
		);
		expect(groups).toHaveLength(1);
		const group = groups[0]!;
		const collapsed = Bun.stripANSI(group.render(120).join("\n"));
		expect(collapsed).toContain(USAGE_TS_LABEL);
		expect(collapsed).toContain(SECOND_USAGE_TS_LABEL);
		expect(ctx.chatContainer.children.filter(c => c.render(120).join("\n").includes(USAGE_LABEL))).toEqual([group]);
		group.setGroupExpanded(true);
		group.setExpanded(true);
		const expanded = Bun.stripANSI(group.render(120).join("\n"));
		expect(expanded.indexOf("src/foo.ts")).toBeLessThan(expanded.indexOf(USAGE_TS_LABEL));
		expect(expanded.indexOf(USAGE_TS_LABEL)).toBeLessThan(expanded.indexOf("src/bar.ts"));
		expect(expanded.indexOf("src/bar.ts")).toBeLessThan(expanded.indexOf(SECOND_USAGE_TS_LABEL));
		expect(expanded).toContain("line1");
		expect(expanded.indexOf("line1")).toBeLessThan(expanded.indexOf(USAGE_TS_LABEL));
	});

	it("keeps mixed-turn usage standalone and separates subsequent grouped reads", () => {
		const { ctx, helpers } = makeHarness(true, true);
		const [first, result] = readTurn();
		const mixed = {
			...first,
			content: [
				...(first as AssistantMessage).content,
				{ type: "toolCall", id: "b1", name: "bash", arguments: { command: "echo mixed" } },
			],
		} as AgentMessage;
		helpers.renderSessionContext({
			messages: [mixed, result, ...readTurn("r2", "src/bar.ts", 2121, SECOND_USAGE_TS)],
		} as SessionContext);
		const children = ctx.chatContainer.children;
		const groups = children.filter((c): c is ToolCallGroupComponent => c instanceof ToolCallGroupComponent);
		expect(groups).toHaveLength(2);
		const standalone = children.findIndex(c => c !== groups[0] && c.render(120).join("\n").includes(USAGE_LABEL));
		expect(standalone).toBeGreaterThan(children.indexOf(groups[0]!));
		expect(standalone).toBeLessThan(children.indexOf(groups[1]!));
		expect(groups[0]!.render(120).join("\n")).not.toContain(USAGE_LABEL);
		expect(groups[1]!.render(120).join("\n")).toContain(SECOND_USAGE_TS_LABEL);
	});

	it("renders no grouped usage when showTokenUsage is off", () => {
		const { ctx, helpers } = makeHarness(false, true);
		helpers.renderSessionContext({ messages: readTurn() } as SessionContext);
		expect(ctx.chatContainer.children.some(c => c.render(120).join("\n").includes(USAGE_LABEL))).toBe(false);
	});

	it("renders no usage row when showTokenUsage is off", () => {
		const { ctx, helpers } = makeHarness(false);
		helpers.renderSessionContext({ messages: readTurn() } as SessionContext);

		const children = ctx.chatContainer.children;
		expect(children.some(c => c.render(120).join("\n").includes(USAGE_LABEL))).toBe(false);
		// Last block is the read group, not a usage row.
		expect(children[children.length - 1]).toBeInstanceOf(ReadToolGroupComponent);
	});
});

describe("ToolCallGroupComponent usage ownership", () => {
	it("anchors one usage row after the last surviving call and invalidates on changes", () => {
		const group = new ToolCallGroupComponent();
		const usage = (readTurn()[0] as AssistantMessage).usage;
		group.beginCall("read", { path: "one.ts" }, "one");
		group.beginCall("read", { path: "two.ts" }, "two");
		group.setGroupExpanded(true);
		group.render(120);
		const version = group.getTranscriptBlockVersion();
		expect(group.attachUsage(["missing"], usage, undefined, undefined, USAGE_TS)).toBe(false);
		expect(group.attachUsage(["one", "two"], usage, undefined, undefined, USAGE_TS)).toBe(true);
		expect(group.getTranscriptBlockVersion()).toBeGreaterThan(version);
		let rendered = Bun.stripANSI(group.render(120).join("\n"));
		expect(rendered.indexOf("two.ts")).toBeLessThan(rendered.indexOf(USAGE_TS_LABEL));
		expect(rendered.split(USAGE_TS_LABEL)).toHaveLength(2);
		group.renameEntry("two", "renamed");
		group.removeEntry("renamed");
		rendered = Bun.stripANSI(group.render(120).join("\n"));
		expect(rendered.indexOf("one.ts")).toBeLessThan(rendered.indexOf(USAGE_TS_LABEL));
		expect(rendered).toContain(USAGE_TS_LABEL);
	});
});

describe("ChatTranscriptBuilder grouped usage placement", () => {
	it("keeps consecutive read metrics in their group across rebuild and expansion", () => {
		const previous = { ...chatTranscriptDisplayPreferences };
		setChatTranscriptDisplayPreferences({ groupConsecutiveTools: true, showTokenUsage: true });
		try {
			const builder = new ChatTranscriptBuilder({
				ui: { requestRender: () => {}, requestComponentRender: () => {} } as unknown as TUI,
				cwd: process.cwd(),
				requestRender: () => {},
			});
			builder.rebuild(
				[...readTurn(), ...readTurn("r2", "src/bar.ts", 2121, SECOND_USAGE_TS)].map((message, index) => ({
					type: "message",
					id: `g${index}`,
					parentId: index ? `g${index - 1}` : null,
					timestamp: new Date(0).toISOString(),
					message,
				})),
			);
			const groups = builder.container.children.filter(
				(c): c is ToolCallGroupComponent => c instanceof ToolCallGroupComponent,
			);
			expect(groups).toHaveLength(1);
			builder.setGroupExpanded(true);
			const rendered = Bun.stripANSI(groups[0]!.render(120).join("\n"));
			expect(rendered.indexOf("src/foo.ts")).toBeLessThan(rendered.indexOf(USAGE_TS_LABEL));
			expect(rendered.indexOf(USAGE_TS_LABEL)).toBeLessThan(rendered.indexOf("src/bar.ts"));
			expect(rendered.indexOf("src/bar.ts")).toBeLessThan(rendered.indexOf(SECOND_USAGE_TS_LABEL));
			expect(builder.container.children.filter(c => c.render(120).join("\n").includes(USAGE_LABEL))).toEqual(groups);
		} finally {
			setChatTranscriptDisplayPreferences(previous);
		}
	});
});

describe("ChatTranscriptBuilder token-usage row timestamp", () => {
	beforeEach(async () => {
		await Settings.init({ inMemory: true, cwd: process.cwd() });
		cfgDisplayShowTokenUsage.set(settings, true);
	});
	afterEach(() => {
		resetSettingsForTest();
	});

	it("renders the turn's local timestamp on the rebuilt usage row", () => {
		const builder = new ChatTranscriptBuilder({
			ui: { requestRender: () => {}, requestComponentRender: () => {} } as unknown as TUI,
			cwd: process.cwd(),
			requestRender: () => {},
		});
		const message = {
			role: "assistant",
			content: [{ type: "text", text: "done" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			stopReason: "stop",
			usage: {
				input: USAGE_INPUT,
				output: 7,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: USAGE_INPUT + 7,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: USAGE_TS,
		} as unknown as AgentMessage;
		builder.rebuild([{ type: "message", id: "m1", parentId: null, timestamp: new Date(0).toISOString(), message }]);
		const children = builder.container.children;
		const last = children[children.length - 1]!;
		const rendered = last.render(120).join("\n");
		expect(rendered).toContain(USAGE_TS_LABEL);
		expect(rendered).toContain(USAGE_LABEL);
	});

	it("deep-links tool-only assistant entries to their first rendered row", () => {
		const builder = new ChatTranscriptBuilder({
			ui: new TUI(new VirtualTerminal(120, 20)),
			cwd: process.cwd(),
			requestRender: () => {},
		});
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "echo ok" } }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			stopReason: "toolUse",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: 1_000,
		};
		builder.rebuild([
			{ type: "message", id: "tool-entry", parentId: null, timestamp: new Date(0).toISOString(), message },
		]);

		const rendered = builder.container.render(120);
		expect(Bun.stripANSI(rendered.join("\n"))).toContain("echo ok");
		expect(builder.rowForEntry("tool-entry")).toBe(0);
	});

	it("keeps grouped read metrics nested on the reusable transcript-builder path", () => {
		const builder = new ChatTranscriptBuilder({
			ui: { requestRender: () => {}, requestComponentRender: () => {} } as unknown as TUI,
			cwd: process.cwd(),
			requestRender: () => {},
		});
		const messages = [...readTurn(), ...readTurn("r2", "src/bar.ts", 2121, SECOND_USAGE_TS)];
		builder.rebuild(
			messages.map((message, index) => ({
				type: "message",
				id: `m${index}`,
				parentId: index === 0 ? null : `m${index - 1}`,
				timestamp: new Date(0).toISOString(),
				message,
			})),
		);

		const groups = builder.container.children.filter(
			(component): component is ReadToolGroupComponent => component instanceof ReadToolGroupComponent,
		);
		expect(groups).toHaveLength(1);
		const rendered = groups[0]!.render(120).join("\n");
		expect(rendered).toContain(USAGE_TS_LABEL);
		expect(rendered).toContain(SECOND_USAGE_TS_LABEL);
		expect(
			builder.container.children.filter(component => component.render(120).join("\n").includes(USAGE_LABEL)),
		).toEqual([groups[0]!]);
	});
});
