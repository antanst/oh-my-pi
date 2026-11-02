import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { AssistantMessage, ToolCall } from "@oh-my-pi/pi-ai";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EventController } from "@oh-my-pi/pi-coding-agent/modes/controllers/event-controller";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import {
	chatTranscriptDisplayPreferences,
	setChatTranscriptDisplayPreferences,
} from "@oh-my-pi/pi-tui/chat/display-preferences";
import { ReadToolGroupComponent } from "@oh-my-pi/pi-tui/chat/read-tool-group";
import { ToolCallGroupComponent } from "@oh-my-pi/pi-tui/chat/tool-call-group";
import { ToolExecutionComponent } from "@oh-my-pi/pi-tui/chat/tool-execution";
import type { NativeNode } from "@oh-my-pi/pi-tui/native/node";
import { isNativeRendering, setNativeRendering } from "@oh-my-pi/pi-tui/native/state";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import { createInteractiveModeContext } from "./helpers/interactive-mode-context";

const controllers: EventController[] = [];
let previousGrouping: boolean;

/** Make a complete provider snapshot for cumulative streaming updates. */
function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		stopReason: "toolUse",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp: 1,
	};
}

/** Build the real controller and retain the approval waiter it registers. */
function createFixture() {
	let approvalWaiter: ((toolCallId: string) => Promise<void>) | undefined;
	const ctx = createInteractiveModeContext({
		hideThinkingBlock: true,
		session: {
			extensionRunner: {
				getAssistantThinkingRenderers: () => [],
				setToolApprovalPreviewWaiter(waiter) {
					approvalWaiter = waiter;
					return () => {
						approvalWaiter = undefined;
					};
				},
			},
		},
	});
	const controller = new EventController(ctx);
	controllers.push(controller);
	return { controller, ctx, getApprovalWaiter: () => approvalWaiter };
}

/** Create a call with identifiable command or path content. */
function toolCall(id: string, name = "bash"): ToolCall {
	return { type: "toolCall", id, name, arguments: name === "read" ? { path: `${id}.ts` } : { command: id } };
}

/** Deliver a cumulative snapshot through the public event path. */
async function update(controller: EventController, content: AssistantMessage["content"]): Promise<void> {
	const message = assistantMessage(content);
	await controller.handleEvent({
		type: "message_update",
		message,
		assistantMessageEvent: { type: "text_delta", contentIndex: content.length - 1, delta: "", partial: message },
	});
}

/** Start an execution without requiring a streamed preview. */
async function start(controller: EventController, call: ToolCall): Promise<void> {
	await controller.handleEvent({
		type: "tool_execution_start",
		toolCallId: call.id,
		toolName: call.name,
		args: call.arguments,
	});
}

/** Complete a call with an observable success or failure result. */
async function finish(controller: EventController, call: ToolCall, isError = false): Promise<void> {
	await controller.handleEvent({
		type: "tool_execution_end",
		toolCallId: call.id,
		toolName: call.name,
		result: { content: [{ type: "text", text: isError ? "OBSOLETE_FAILURE" : "completed" }] },
		isError,
	});
}

/** Read the real shell renderer's status nodes without depending on its card wrapper. */
function nativeRunStates(node: NativeNode): NativeNode[] {
	const states = node.p?.role === "omp.run.state" ? [node] : [];
	for (const child of node.c ?? []) {
		if ("k" in child) states.push(...nativeRunStates(child));
	}
	return states;
}

beforeAll(async () => {
	await initTheme(false);
});

beforeEach(async () => {
	previousGrouping = chatTranscriptDisplayPreferences.groupConsecutiveTools;
	resetSettingsForTest();
	await Settings.init({ inMemory: true, overrides: { "display.smoothStreaming": false } });
	setChatTranscriptDisplayPreferences({ groupConsecutiveTools: true });
});

afterEach(() => {
	for (const controller of controllers.splice(0)) controller.dispose();
	setChatTranscriptDisplayPreferences({ groupConsecutiveTools: previousGrouping });
	resetSettingsForTest();
});

describe("EventController grouped tool lifecycle", () => {
	it("releases the real approval-preview waiter for a start-only grouped call", async () => {
		const { controller, ctx, getApprovalWaiter } = createFixture();
		const waiter = getApprovalWaiter();
		if (!waiter) throw new Error("Controller did not register its approval waiter");
		const approved = waiter("approval-call");
		await start(controller, toolCall("approval-call"));
		expect(ctx.pendingTools.get("approval-call")).toBeInstanceOf(ToolCallGroupComponent);
		await approved;
	});

	for (const settledFirst of [false, true]) {
		it(`keeps a failed background result when settlement arrives ${settledFirst ? "before" : "after"} launch`, async () => {
			const { controller, ctx } = createFixture();
			const call: ToolCall = { type: "toolCall", id: "background", name: "task", arguments: { tasks: [] } };
			await start(controller, call);
			const group = ctx.pendingTools.get(call.id);
			if (!(group instanceof ToolCallGroupComponent)) throw new Error("Expected a grouped task");
			const launch: Extract<AgentSessionEvent, { type: "tool_execution_end" }> = {
				type: "tool_execution_end",
				toolCallId: call.id,
				toolName: call.name,
				result: {
					content: [{ type: "text", text: "launched" }],
					details: { async: { state: "running", jobId: "job-1", type: "task" } },
				},
				isError: false,
			};
			const settled: Extract<AgentSessionEvent, { type: "tool_execution_update" }> = {
				type: "tool_execution_update",
				toolCallId: call.id,
				toolName: call.name,
				args: call.arguments,
				partialResult: {
					content: [{ type: "text", text: "BACKGROUND_FAILED" }],
					details: { async: { state: "failed", jobId: "job-1", type: "task" } },
				},
			};
			await controller.handleEvent(settledFirst ? settled : launch);
			expect(ctx.pendingTools.get(call.id)).toBe(group);
			await controller.handleEvent(settledFirst ? launch : settled);
			expect(ctx.pendingTools.has(call.id)).toBe(false);
			expect(Bun.stripANSI(group.render(120).join("\n"))).toContain("✗");
			group.setGroupExpanded(true);
			expect(Bun.stripANSI(group.render(120).join("\n"))).toContain("BACKGROUND_FAILED");
		});
	}

	for (const [cancelledFirst, cleanup] of [
		[false, "agent_start"],
		[true, "agent_start"],
		[false, "agent_end"],
		[true, "agent_end"],
	] as const) {
		it(`preserves background siblings across ${cancelledFirst ? "early" : "late"} cancellation and ${cleanup}`, async () => {
			const wasNative = isNativeRendering();
			setNativeRendering(true);
			try {
				const { controller, ctx } = createFixture();
				const cancelled = toolCall("cancelled-background");
				const sibling = toolCall("running-background");
				const later = toolCall("later-background");
				await start(controller, cancelled);
				await start(controller, sibling);
				const group = ctx.pendingTools.get(cancelled.id);
				if (!(group instanceof ToolCallGroupComponent)) throw new Error("Expected a grouped shell run");
				group.setGroupExpanded(true);
				group.setExpanded(true);

				/** Deliver the shell launch response through the real controller. */
				const launch = (call: ToolCall): Promise<void> =>
					controller.handleEvent({
						type: "tool_execution_end",
						toolCallId: call.id,
						toolName: call.name,
						result: {
							content: [{ type: "text", text: "background output" }],
							details: { async: { state: "running", jobId: call.id, type: "bash" } },
						},
						isError: false,
					});
				const cancellation: Extract<AgentSessionEvent, { type: "tool_execution_update" }> = {
					type: "tool_execution_update",
					toolCallId: cancelled.id,
					toolName: cancelled.name,
					args: cancelled.arguments,
					partialResult: {
						content: [{ type: "text", text: "partial output" }],
						details: { async: { state: "cancelled", jobId: cancelled.id, type: "bash" } },
					},
				};
				await launch(sibling);
				if (cancelledFirst) {
					await controller.handleEvent(cancellation);
					await launch(cancelled);
				} else {
					await launch(cancelled);
					await controller.handleEvent(cancellation);
				}

				expect(ctx.pendingTools.has(cancelled.id)).toBe(false);
				expect(ctx.pendingTools.get(sibling.id)).toBe(group);
				expect(group.isTranscriptBlockFinalized()).toBe(false);
				const states = group.children
					.filter(child => child instanceof ToolExecutionComponent)
					.flatMap(child => nativeRunStates(child.describe()));
				expect(states).toMatchObject([{ p: { tone: "muted" } }, { p: { tone: "pending" } }]);

				await start(controller, later);
				await launch(later);
				expect(ctx.pendingTools.get(sibling.id)).toBe(group);
				expect(ctx.pendingTools.get(later.id)).toBe(group);
				expect(group.isTranscriptBlockFinalized()).toBe(false);
				const laterStates = group.children
					.filter(child => child instanceof ToolExecutionComponent)
					.flatMap(child => nativeRunStates(child.describe()));
				expect(laterStates).toMatchObject([
					{ p: { tone: "muted" } },
					{ p: { tone: "pending" } },
					{ p: { tone: "pending" } },
				]);

				const abandoned = toolCall("abandoned-foreground");
				await start(controller, abandoned);
				await controller.handleEvent({
					type: "tool_execution_update",
					toolCallId: abandoned.id,
					toolName: abandoned.name,
					args: abandoned.arguments,
					partialResult: { content: [{ type: "text", text: "foreground output" }] },
				});
				await controller.handleEvent(cleanup === "agent_end" ? { type: cleanup, messages: [] } : { type: cleanup });
				expect(ctx.pendingTools.has(abandoned.id)).toBe(false);
				expect(ctx.pendingTools.get(sibling.id)).toBe(group);
				expect(ctx.pendingTools.get(later.id)).toBe(group);
				expect(group.isTranscriptBlockFinalized()).toBe(false);
				const nextTurnStates = group.children
					.filter(child => child instanceof ToolExecutionComponent)
					.flatMap(child => nativeRunStates(child.describe()));
				expect(nextTurnStates).toMatchObject([
					{ p: { tone: "muted" } },
					{ p: { tone: "pending" } },
					{ p: { tone: "pending" } },
					{ p: { tone: "muted" } },
				]);
			} finally {
				setNativeRendering(wasNative);
			}
		});
	}

	for (const streamedRetry of [false, true]) {
		it(`replaces a failed same-ID ${streamedRetry ? "streamed" : "start-only"} retry without losing its sibling`, async () => {
			const { controller, ctx } = createFixture();
			ctx.toolGroupExpanded = true;
			const retry = toolCall("retried-command");
			const sibling = toolCall("successful-sibling");
			await start(controller, retry);
			await finish(controller, retry, true);
			await start(controller, sibling);
			await finish(controller, sibling);
			await controller.handleEvent({ type: "agent_end", messages: [] });
			if (streamedRetry) {
				await controller.handleEvent({ type: "message_start", message: assistantMessage([]) });
				await update(controller, [retry]);
			}
			await start(controller, retry);
			await finish(controller, retry);
			const rendered = Bun.stripANSI(ctx.chatContainer.render(120).join("\n"));
			expect(rendered.match(/retried-command/g)).toHaveLength(1);
			expect(rendered.match(/successful-sibling/g)).toHaveLength(1);
			expect(rendered).not.toContain("OBSOLETE_FAILURE");
			expect(rendered).not.toContain("✗");
			expect(ctx.pendingTools.size).toBe(0);
		});
	}
});

describe("EventController grouped tool order", () => {
	it("places prose between separate groups inside one assistant snapshot", async () => {
		const { controller, ctx } = createFixture();
		await controller.handleEvent({ type: "message_start", message: assistantMessage([]) });
		await update(controller, [
			toolCall("FIRST_COMMAND"),
			{ type: "text", text: "BETWEEN_CALLS" },
			toolCall("LAST_COMMAND"),
		]);
		const groups = ctx.chatContainer.children.filter(child => child instanceof ToolCallGroupComponent);
		expect(groups).toHaveLength(2);
		const rendered = Bun.stripANSI(ctx.chatContainer.render(120).join("\n"));
		expect(rendered.indexOf("FIRST_COMMAND")).toBeLessThan(rendered.indexOf("BETWEEN_CALLS"));
		expect(rendered.indexOf("BETWEEN_CALLS")).toBeLessThan(rendered.indexOf("LAST_COMMAND"));
	});

	it("does not reapply repeated leading prose when consecutive calls stream cumulatively", async () => {
		const { controller, ctx } = createFixture();
		await controller.handleEvent({ type: "message_start", message: assistantMessage([]) });
		const prefix: AssistantMessage["content"] = [{ type: "text", text: "INTRODUCTION" }, toolCall("first")];
		await update(controller, prefix);
		await update(controller, [...prefix, toolCall("second")]);
		expect(ctx.chatContainer.children.filter(child => child instanceof ToolCallGroupComponent)).toHaveLength(1);
		expect(ctx.pendingTools.get("first")).toBe(ctx.pendingTools.get("second"));
	});

	it("applies a newly visible text boundary once and groups subsequent calls together", async () => {
		const { controller, ctx } = createFixture();
		await controller.handleEvent({ type: "message_start", message: assistantMessage([]) });
		await update(controller, [toolCall("before"), { type: "text", text: "" }]);
		const prefix: AssistantMessage["content"] = [
			toolCall("before"),
			{ type: "text", text: "NOW_VISIBLE" },
			toolCall("after"),
		];
		await update(controller, prefix);
		await update(controller, [...prefix, toolCall("after-again")]);
		expect(ctx.chatContainer.children.filter(child => child instanceof ToolCallGroupComponent)).toHaveLength(2);
		expect(ctx.pendingTools.get("before")).not.toBe(ctx.pendingTools.get("after"));
		expect(ctx.pendingTools.get("after")).toBe(ctx.pendingTools.get("after-again"));
	});

	it("closes the run when trailing prose appears only in message_end", async () => {
		const { controller, ctx } = createFixture();
		await controller.handleEvent({ type: "message_start", message: assistantMessage([]) });
		await update(controller, [toolCall("before-final-prose")]);
		await controller.handleEvent({
			type: "message_end",
			message: assistantMessage([toolCall("before-final-prose"), { type: "text", text: "FINAL_BOUNDARY" }]),
		});
		await start(controller, toolCall("after-final-prose"));
		expect(ctx.chatContainer.children.filter(child => child instanceof ToolCallGroupComponent)).toHaveLength(2);
	});

	it("keeps collapsed thinking inside an uninterrupted tool run", async () => {
		const { controller, ctx } = createFixture();
		await controller.handleEvent({ type: "message_start", message: assistantMessage([]) });
		await update(controller, [toolCall("first"), { type: "thinking", thinking: "reasoning" }, toolCall("second")]);
		expect(ctx.pendingTools.get("first")).toBe(ctx.pendingTools.get("second"));
	});

	for (const streaming of [false, true]) {
		it(`separates read/bash/read runs in the ${streaming ? "streaming" : "start-only"} path`, async () => {
			const { controller, ctx } = createFixture();
			const calls = [toolCall("first-read", "read"), toolCall("middle-bash"), toolCall("last-read", "read")];
			if (streaming) {
				await controller.handleEvent({ type: "message_start", message: assistantMessage([]) });
				await update(controller, calls);
				await update(controller, [...calls, toolCall("last-bash"), toolCall("last-bash-sibling")]);
				expect(ctx.pendingTools.get("last-bash")).toBe(ctx.pendingTools.get("last-bash-sibling"));
			} else {
				for (const call of calls) await start(controller, call);
			}
			const readGroups = ctx.chatContainer.children.filter(child => child instanceof ReadToolGroupComponent);
			expect(readGroups).toHaveLength(2);
			expect(ctx.pendingTools.get("first-read")).not.toBe(ctx.pendingTools.get("last-read"));
			const rendered = Bun.stripANSI(ctx.chatContainer.render(120).join("\n"));
			expect(rendered.indexOf("first-read.ts")).toBeLessThan(rendered.indexOf("middle-bash"));
			expect(rendered.indexOf("middle-bash")).toBeLessThan(rendered.indexOf("last-read.ts"));
		});
	}

	it("keeps ordinary cards when grouping is disabled", async () => {
		setChatTranscriptDisplayPreferences({ groupConsecutiveTools: false });
		const { controller, ctx } = createFixture();
		await controller.handleEvent({ type: "message_start", message: assistantMessage([]) });
		await update(controller, [
			toolCall("ordinary-first"),
			{ type: "text", text: "ordinary prose" },
			toolCall("ordinary-last"),
		]);
		expect(ctx.chatContainer.children.filter(child => child instanceof ToolCallGroupComponent)).toHaveLength(0);
		expect(ctx.chatContainer.children.filter(child => child instanceof ToolExecutionComponent)).toHaveLength(2);
	});
});
