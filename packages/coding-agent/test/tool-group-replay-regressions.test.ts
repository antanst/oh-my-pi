import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, ToolCall } from "@oh-my-pi/pi-ai";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { UiHelpers } from "@oh-my-pi/pi-coding-agent/modes/utils/ui-helpers";
import type { SessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import { type Component, setKeybindings, TERMINAL } from "@oh-my-pi/pi-tui";
import { KeybindingsManager, type KeyId } from "@oh-my-pi/pi-tui/app-keybindings";
import { ChatTranscriptBuilder } from "@oh-my-pi/pi-tui/chat/chat-transcript-builder";
import {
	chatTranscriptDisplayPreferences,
	setChatTranscriptDisplayPreferences,
} from "@oh-my-pi/pi-tui/chat/display-preferences";
import { ToolCallGroupComponent } from "@oh-my-pi/pi-tui/chat/tool-call-group";
import { stopSharedSpinnerTicker } from "@oh-my-pi/pi-tui/chat/tool-execution";
import type { SessionMessageEntryLike } from "@oh-my-pi/pi-tui/chat/transcript-entry";
import { appendOutlineEntries, outlineVisibility } from "@oh-my-pi/pi-tui/chat/transcript-outline";
import type { AgentRecordLike } from "@oh-my-pi/pi-tui/overlays/agent-hub-types";
import { AgentTranscriptViewer, type AgentTranscriptEntry } from "@oh-my-pi/pi-tui/overlays/agent-transcript-viewer";
import { collectBlocks, CopySelectorComponent } from "@oh-my-pi/pi-tui/overlays/copy-selector";
import { RewindSelectorComponent } from "@oh-my-pi/pi-tui/overlays/rewind-selector";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { createInteractiveModeContext } from "./helpers/interactive-mode-context";

/** A deterministic assistant completion with ordered content. */
function assistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
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

/** Distinct commands expose rows hidden by collapsed groups. */
function call(id: string): ToolCall {
	return { type: "toolCall", id, name: "bash", arguments: { command: `echo command-${id}` } };
}

/** Distinct output exposes independent result expansion. */
function result(id: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: "bash",
		content: [{ type: "text", text: `output-${id}` }],
		isError: false,
		timestamp: 2,
	};
}

/** Preserve the original message identity in persisted entries. */
function entries(messages: AgentMessage[]): SessionMessageEntryLike[] {
	return messages.map((message, index) => ({
		type: "message",
		id: `m${index}`,
		parentId: index ? `m${index - 1}` : null,
		timestamp: "2026-01-01T00:00:00Z",
		message,
	}));
}

/** Render consumer-visible text without terminal styling. */
function plain(component: Component): string {
	return Bun.stripANSI(component.render(120).join("\n"));
}

/** Create a real builder with the shared interactive UI fixture. */
function builder(): ChatTranscriptBuilder {
	const context = createInteractiveModeContext();
	const value = new ChatTranscriptBuilder({ ui: context.ui, cwd: process.cwd(), requestRender() {} });
	disposables.push(value);
	return value;
}

/** Replay through the main transcript's actual helper. */
function replay(messages: AgentMessage[], grouping = true, showImages = false): readonly Component[] {
	const context = createInteractiveModeContext({
		settings: Settings.isolated({
			"display.groupConsecutiveTools": grouping,
			"display.showTokenUsage": false,
			"terminal.showImages": showImages,
		}),
	});
	const helpers = new UiHelpers(context);
	context.addMessageToChat = helpers.addMessageToChat.bind(helpers);
	helpers.renderSessionContext({ messages } as SessionContext);
	disposables.push(context.chatContainer);
	return context.chatContainer.children;
}

const disposables: Array<{ dispose(): void }> = [];
let directory: string | undefined;
let previousPreferences = { ...chatTranscriptDisplayPreferences };

beforeAll(async () => {
	await initTheme();
});
beforeEach(async () => {
	previousPreferences = { ...chatTranscriptDisplayPreferences };
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
	setChatTranscriptDisplayPreferences({ groupConsecutiveTools: true, hideToolActivity: false, showTokenUsage: false });
	setKeybindings(KeybindingsManager.inMemory());
});
afterEach(() => {
	for (const disposable of disposables.splice(0)) disposable.dispose();
	stopSharedSpinnerTicker();
	if (directory) fs.rmSync(directory, { recursive: true, force: true });
	directory = undefined;
	setKeybindings(KeybindingsManager.inMemory());
	resetSettingsForTest();
	setChatTranscriptDisplayPreferences(previousPreferences);
});

describe("tool group replay boundaries", () => {
	it("main replay keeps a read image visible and starts a new run after it", () => {
		const protocol = Object.getOwnPropertyDescriptor(TERMINAL, "imageProtocol")!;
		Object.defineProperty(TERMINAL, "imageProtocol", { value: null });
		try {
			const read: ToolCall = { type: "toolCall", id: "image", name: "read", arguments: { path: "pixel.png" } };
			const children = replay(
				[
					assistant([call("one"), read]),
					result("one"),
					{
						role: "toolResult",
						toolCallId: "image",
						toolName: "read",
						content: [
							{
								type: "image",
								mimeType: "image/png",
								data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
							},
						],
						isError: false,
						timestamp: 2,
					},
					assistant([call("two")]),
					result("two"),
				],
				true,
				true,
			);
			expect(children.filter(child => child instanceof ToolCallGroupComponent)).toHaveLength(2);
			expect(children.map(plain).join("\n")).toContain("[Image: image/png]");
		} finally {
			Object.defineProperty(TERMINAL, "imageProtocol", protocol);
		}
	});

	it("a late read image does not split a newer run", () => {
		const read: ToolCall = { type: "toolCall", id: "image", name: "read", arguments: { path: "pixel.png" } };
		const children = replay(
			[
				assistant([read, { type: "text", text: "boundary" }, call("one")]),
				{
					role: "toolResult",
					toolCallId: "image",
					toolName: "read",
					content: [
						{
							type: "image",
							mimeType: "image/png",
							data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
						},
					],
					isError: false,
					timestamp: 2,
				},
				assistant([call("two")]),
				result("one"),
				result("two"),
			],
			true,
			true,
		);
		const groups = children.filter(child => child instanceof ToolCallGroupComponent);
		expect(groups).toHaveLength(2);
		groups[1]!.setGroupExpanded(true);
		expect(plain(groups[1]!)).toContain("command-one");
		expect(plain(groups[1]!)).toContain("command-two");
	});

	it("main replay retains mixed read results in call order after a group boundary", () => {
		const read: ToolCall = { type: "toolCall", id: "read", name: "read", arguments: { path: "skill://example" } };
		const children = replay([
			assistant([call("one"), read, call("two"), { type: "text", text: "boundary" }]),
			result("two"),
			{
				role: "toolResult",
				toolCallId: "read",
				toolName: "read",
				content: [{ type: "text", text: "read failure" }],
				isError: true,
				timestamp: 2,
			},
			result("one"),
		]);
		const groups = children.filter(child => child instanceof ToolCallGroupComponent);
		expect(groups).toHaveLength(1);
		const group = groups[0]!;
		group.setGroupExpanded(true);
		group.setExpanded(true);
		const rendered = plain(group);
		const positions = ["command-one", "skill://example", "command-two"].map(text => rendered.indexOf(text));
		expect(positions.every(position => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(rendered).toContain("read failure");
		expect(rendered).toContain("output-one");
		expect(rendered).toContain("output-two");
	});

	it("main replay keeps read rendering separate when grouping is disabled", () => {
		const read: ToolCall = { type: "toolCall", id: "read", name: "read", arguments: { path: "file.txt" } };
		const children = replay(
			[
				assistant([call("one"), read, call("two")]),
				result("one"),
				{
					role: "toolResult",
					toolCallId: "read",
					toolName: "read",
					content: [{ type: "text", text: "file contents" }],
					isError: false,
					timestamp: 2,
				},
				result("two"),
			],
			false,
		);
		expect(children.filter(child => child instanceof ToolCallGroupComponent)).toHaveLength(0);
		expect(children.map(plain).join("\n")).toContain("file.txt");
	});

	for (const surface of ["main", "builder"] as const) {
		it(`${surface} keeps within-message and trailing prose between the correct groups`, () => {
			const messages = [
				assistant([
					call("one"),
					{ type: "text", text: "between calls" },
					call("two"),
					{ type: "text", text: "after calls" },
				]),
				result("one"),
				result("two"),
				assistant([call("three")]),
				result("three"),
			];
			const transcript = builder();
			if (surface === "builder") transcript.rebuild(entries(messages));
			const children = surface === "main" ? replay(messages) : transcript.container.children;
			const groups = children.filter(child => child instanceof ToolCallGroupComponent);
			expect(groups).toHaveLength(3);
			const rendered = children.map(plain).join("\n");
			const ordered = ["command-one", "between calls", "command-two", "after calls", "command-three"].map(text =>
				rendered.indexOf(text),
			);
			expect(ordered.every(index => index >= 0)).toBe(true);
			expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
		});

		it(`${surface} does not move a leading call away from the preceding run because prose follows it`, () => {
			const messages = [
				assistant([call("one")]),
				result("one"),
				assistant([call("two"), { type: "text", text: "boundary" }, call("three")]),
				result("two"),
				result("three"),
			];
			const transcript = builder();
			if (surface === "builder") transcript.rebuild(entries(messages));
			const children = surface === "main" ? replay(messages) : transcript.container.children;
			const groups = children.filter(child => child instanceof ToolCallGroupComponent);
			expect(groups).toHaveLength(2);
			groups[0]!.setGroupExpanded(true);
			expect(plain(groups[0]!)).toContain("command-one");
			expect(plain(groups[0]!)).toContain("command-two");
			expect(plain(groups[0]!)).not.toContain("command-three");
		});
	}

	it("keeps rebuild, append batches, and a rebuild followed by append equivalent", () => {
		const history = entries([assistant([call("one")]), result("one"), assistant([call("two")]), result("two")]);
		const complete = builder();
		complete.rebuild(history);
		const incremental = builder();
		for (const entry of history) incremental.append([entry]);
		const tailed = builder();
		tailed.rebuild(history.slice(0, 2));
		tailed.append(history.slice(2));
		for (const transcript of [complete, incremental, tailed]) {
			const groups = transcript.container.children.filter(child => child instanceof ToolCallGroupComponent);
			expect(groups).toHaveLength(1);
			expect(plain(groups[0]!)).toContain("command-two");
			expect(plain(groups[0]!)).not.toContain("command-one");
			expect(plain(transcript.container)).toBe(plain(complete.container));
		}
	});

	it("folds shared components into one selectable target retaining every source entry", () => {
		const history = entries([
			{ role: "user", content: "run both", timestamp: 0 },
			assistant([call("one")]),
			result("one"),
			assistant([call("two")]),
			result("two"),
			assistant([{ type: "text", text: "finished" }]),
		]);
		const transcript = builder();
		const targets = appendOutlineEntries(transcript, history);
		expect(targets.map(target => target.entryId)).toEqual(["m0", "m4", "m5"]);
		expect(targets[1]!.entries).toEqual(history.slice(1, 5));
		transcript.setGroupExpanded(true);
		transcript.setExpanded(true);
		const rows = transcript.container.children.map(child => child.render(120));
		expect(outlineVisibility(rows, targets)).toEqual([true, true, true]);
		const ranges = targets.map(target => Bun.stripANSI(rows.slice(target.start, target.end).flat().join("\n")));
		expect(ranges[1]!.split("output-one")).toHaveLength(2);
		expect(ranges[1]!.split("output-two")).toHaveLength(2);
		expect(ranges[1]).not.toContain("finished");
		expect(ranges[2]).toContain("finished");
		expect(ranges[2]).not.toContain("output-one");
		expect(ranges[2]).not.toContain("output-two");
		const covered = targets.flatMap(target =>
			Array.from({ length: target.end - target.start }, (_, index) => target.start + index),
		);
		expect(covered).toEqual(Array.from({ length: rows.length }, (_, index) => index));
		const groupIndex = transcript.container.children.findIndex(child => child instanceof ToolCallGroupComponent);
		expect(targets[1]!.start).toBeLessThanOrEqual(groupIndex);
		expect(targets[1]!.end).toBeGreaterThan(groupIndex);
		transcript.container.render(120);
		expect(transcript.rowForEntry("m3")).toBe(
			transcript.container.getChildStartRow(transcript.container.children[groupIndex]!),
		);
		expect(transcript.rowForEntry("m4")).toBe(transcript.rowForEntry("m3"));
	});

	it("keeps one outline owner when a run continues past a thinking-only entry", () => {
		const history = entries([
			assistant([call("one")]),
			result("one"),
			assistant([{ type: "thinking", thinking: "choose the next command" }]),
			assistant([call("two")]),
			result("two"),
		]);
		const transcript = builder();
		const targets = appendOutlineEntries(transcript, history);
		expect(targets).toHaveLength(1);
		expect(targets[0]!.entryId).toBe("m4");
		expect(targets[0]!.entries).toEqual(history);
		expect(targets[0]!.start).toBe(0);
		expect(targets[0]!.end).toBe(transcript.container.children.length);
	});

	it("keeps prose from a mixed continuation outside the shared group's selection range", () => {
		const continuation = assistant([call("two"), { type: "text", text: "finished" }]);
		const history = entries([assistant([call("one")]), result("one"), continuation, result("two")]);
		const transcript = builder();
		const targets = appendOutlineEntries(transcript, history);
		expect(targets.map(target => target.entryId)).toEqual(["m3", "m2"]);
		expect(new Set(targets.map(target => target.turnId)).size).toBe(targets.length);
		expect(targets.flatMap(target => collectBlocks(target.entries).map(block => block.content))).toEqual([
			"echo command-one",
			"output-one",
			"echo command-two",
			"output-two",
		]);
		transcript.setGroupExpanded(true);
		transcript.setExpanded(true);
		const rows = transcript.container.children.map(child => child.render(120));
		const ranges = targets.map(target => Bun.stripANSI(rows.slice(target.start, target.end).flat().join("\n")));
		expect(ranges[0]!.split("output-one")).toHaveLength(2);
		expect(ranges[0]!.split("output-two")).toHaveLength(2);
		expect(ranges[0]).not.toContain("finished");
		expect(ranges[1]).toContain("finished");
		expect(ranges[1]).not.toContain("output-");
		expect(targets[0]!.end).toBe(targets[1]!.start);
		expect(targets[1]!.end).toBe(rows.length);
		expect(continuation.content).toEqual([call("two"), { type: "text", text: "finished" }]);
	});

	for (const mixed of [false, true]) {
		it(`rewind and copy keep the shared run's complete output separate from ${mixed ? "mixed" : "following"} prose`, () => {
			const history = entries([
				assistant([call("one")]),
				result("one"),
				assistant(mixed ? [call("two"), { type: "text", text: "finished" }] : [call("two")]),
				result("two"),
				...(mixed ? [] : [assistant([{ type: "text", text: "finished" }])]),
			]);
			const context = createInteractiveModeContext();
			const selected: string[] = [];
			const copied: string[] = [];
			const deps = { ui: context.ui, cwd: process.cwd(), requestRender() {}, onCancel() {} };
			const rewind = new RewindSelectorComponent(history, { ...deps, onSelect: id => selected.push(id) });
			const copy = new CopySelectorComponent(history, { ...deps, onPick: text => copied.push(text) });
			disposables.push(rewind, copy);
			rewind.render(120);
			rewind.handleInput("\r");
			rewind.handleInput("\x1b[A");
			rewind.handleInput("\r");
			copy.render(120);
			copy.handleInput("\r");
			copy.handleInput("\x1b[A");
			copy.handleInput("\r");
			expect(selected).toEqual([mixed ? "m2" : "m4", "m3"]);
			expect(copied).toEqual(["finished", "echo command-one\n\noutput-one\n\necho command-two\n\noutput-two"]);
		});
	}

	it("new groups inherit row expansion without enabling output expansion", () => {
		const transcript = builder();
		transcript.setGroupExpanded(true);
		transcript.append(entries([assistant([call("one"), call("two")]), result("one"), result("two")]));
		expect(plain(transcript.container)).toContain("command-one");
		expect(plain(transcript.container)).not.toContain("output-one");
		transcript.setExpanded(true);
		expect(plain(transcript.container)).toContain("output-one");
		transcript.setGroupExpanded(false);
		expect(plain(transcript.container)).not.toContain("command-one");
		expect(plain(transcript.container)).toContain("output-two");
	});
});

describe("shared viewer group controls", () => {
	for (const surface of ["copy", "rewind", "agent"] as const) {
		for (const binding of [
			{ key: "alt+x", data: "\x1bx" },
			{ key: "alt+g", data: "\x1bg" },
		] satisfies Array<{ key: KeyId; data: string }>) {
			it(`${surface} routes ${binding.key} independently of output expansion`, () => {
				setKeybindings(
					KeybindingsManager.inMemory(
						binding.key === "alt+x" ? {} : { "app.tools.toggleGroupExpansion": binding.key },
					),
				);
				const history = entries([assistant([call("one")]), result("one"), assistant([call("two")]), result("two")]);
				const context = createInteractiveModeContext();
				const deps = { ui: context.ui, cwd: process.cwd(), requestRender() {}, onCancel() {} };
				let viewer: CopySelectorComponent | RewindSelectorComponent | AgentTranscriptViewer;
				if (surface === "copy") viewer = new CopySelectorComponent(history, { ...deps, onPick() {} });
				else if (surface === "rewind") viewer = new RewindSelectorComponent(history, { ...deps, onSelect() {} });
				else {
					directory = fs.mkdtempSync(join(tmpdir(), "omp-group-viewer-"));
					const sessionFile = join(directory, "session.jsonl");
					fs.writeFileSync(sessionFile, history.map(entry => JSON.stringify(entry)).join("\n") + "\n");
					const record: AgentRecordLike = {
						id: "worker",
						displayName: "worker",
						kind: "advisor",
						status: "parked",
						session: null,
						sessionFile,
						createdAt: 0,
						lastActivity: 0,
					};
					viewer = new AgentTranscriptViewer({
						...deps,
						agentId: record.id,
						registry: { get: () => record, list: () => [record], onChange: () => () => {} },
						transcript: {
							fs,
							parseEntries: text =>
								text
									.trim()
									.split("\n")
									.map(line => JSON.parse(line) as AgentTranscriptEntry),
						},
						expandKeys: ["ctrl+o"],
						hubKeys: [],
						onClose() {},
						onHubClose() {},
					});
				}
				disposables.push(viewer);
				expect(plain(viewer)).not.toContain("command-one");
				expect(plain(viewer)).toContain("command-two");
				viewer.handleInput("\x0f");
				expect(plain(viewer)).toContain("output-two");
				expect(plain(viewer)).not.toContain("command-one");
				viewer.handleInput(binding.data);
				expect(plain(viewer)).toContain("command-one");
				expect(plain(viewer)).toContain("output-one");
				viewer.handleInput("\x0f");
				expect(plain(viewer)).toContain("command-one");
				expect(plain(viewer)).not.toContain("output-one");
				viewer.handleInput(binding.data);
				expect(plain(viewer)).not.toContain("command-one");
			});
		}
	}
});
