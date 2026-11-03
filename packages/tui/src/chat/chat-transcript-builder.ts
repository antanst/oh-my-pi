/**
 * Builds transcript components from persisted session message entries — the
 * file/remote-backed counterpart to {@link UiHelpers.addMessageToChat} (which is
 * bound to the live InteractiveModeContext). Used by the fullscreen transcript
 * viewer ({@link AgentTranscriptViewer}) to render a parked subagent / advisor /
 * collab-guest transcript that has no live session.
 *
 * Unlike incremental transcript sync, {@link ChatTranscriptBuilder.rebuild}
 * always discards prior components and rebuilds the whole transcript from the
 * supplied entries. Re-rendering a growing transcript is therefore O(n) in the
 * entry count, but it cannot duplicate or misorder rows the way incremental
 * component reuse could.
 */
import type { AgentMessage, AgentTool } from "@oh-my-pi/pi-agent-core";
import type { Usage } from "@oh-my-pi/pi-ai";
import { type Component, type TUI } from "../tui";
import type { AdvisorMessageDetails } from "./messages";
import { COLLAB_PROMPT_MESSAGE_TYPE, type CollabPromptDetails } from "./messages";
import { chatTranscriptDisplayPreferences as displayPreferences } from "./display-preferences";
import type { MessageRenderer } from "./extension-types";
import { LAUNCH_COMPLETION_MESSAGE_TYPE } from "./messages";
import {
	BACKGROUND_TAN_DISPATCH_MESSAGE_TYPE,
	type CustomMessage,
	isUserTurnInitiator,
	LSP_LATE_DIAGNOSTIC_MESSAGE_TYPE,
	SKILL_PROMPT_MESSAGE_TYPE,
	type SkillPromptDetails,
} from "./messages";
import {
	imageContent,
	messageBreaksToolGroup,
	textContent,
	type TranscriptEntryLike as TranscriptEntry,
	transcriptEntryMessage,
} from "./transcript-entry";
import { theme } from "../theme";
import {
	assistantHasVisibleContent,
	assistantUsageIsBilled,
	buildAsyncResultBlock,
	buildFileMentionBlock,
	buildIrcMessageCard,
	buildLaunchCompletionBlock,
	normalizeToolArgs,
	resolveAssistantErrorPresentation,
	splitAssistantMessageToolTimeline,
} from "./transcript-render-helpers";
import { createAdvisorMessageCard } from "./advisor-message";
import { AssistantMessageComponent } from "./assistant-message";
import { createBackgroundTanDispatchBlock } from "./background-tan-message";
import { BashExecutionComponent } from "./bash-execution";
import { detectCacheInvalidation } from "./cache-invalidation-marker";
import { ServedModelTracker } from "./served-model-marker";
import { CollabPromptMessageComponent } from "./collab-prompt-message";
import {
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	createHandoffSummaryMessageComponent,
} from "./compaction-summary-message";
import { CustomMessageComponent } from "./custom-message";
import { EvalExecutionComponent } from "./eval-execution";
import {
	type LateDiagnosticsFile,
	LateDiagnosticsMessageComponent,
	routeLateDiagnostics,
} from "./late-diagnostics-message";
import { groupedReadUsageCallIds, ReadToolGroupComponent, readArgsCollapseIntoGroup } from "./read-tool-group";
import { isReplyWrite, ReplyWriteComponent, replyDisplayMessage, toolResultReplies } from "./reply-write";
import { shouldGroupToolCall, ToolCallGroupComponent } from "./tool-call-group";
import { SkillMessageComponent } from "./skill-message";
import { ToolExecutionComponent, type ToolExecutionHandle } from "./tool-execution";
import { TranscriptContainer } from "../chrome/transcript-container";
import { createUsageRowBlock, TurnUsageTally, turnElapsedMs } from "../overlays/usage-row";
import { CollapsedSyntheticMessageComponent, UserMessageComponent } from "./user-message";

export interface ChatTranscriptBuilderDeps {
	ui: TUI;
	getTool?: (name: string) => AgentTool | undefined;
	/** Whether the active registry entry came from a built-in factory. */
	isBuiltInTool?: (name: string) => boolean;
	getMessageRenderer?: (customType: string) => MessageRenderer | undefined;
	cwd: string;
	hideThinkingBlock?: () => boolean;
	proseOnlyThinking?: () => boolean;
	expandThinkingBlocks?: () => boolean;
	/** Session-scoped resolved destinations for model-authored Markdown links. */
	linkTargets?: ReadonlyMap<string, string>;
	/** Draw charts under numeric tables; false for transcripts that are not the main session's. Default: true. */
	tableCharts?: boolean;
	requestRender: () => void;
}

export class ChatTranscriptBuilder {
	readonly container = new TranscriptContainer();
	#pendingTools = new Map<string, ToolExecutionHandle>();
	#assistantSegments = new WeakMap<Component, Extract<AgentMessage, { role: "assistant" }>>();
	#readArgs = new Map<string, Record<string, unknown>>();
	#readGroup: ReadToolGroupComponent | null = null;
	#toolGroup: ToolCallGroupComponent | null = null;
	#pendingUsage: Usage | undefined;
	#pendingUsageDuration: number | undefined;
	#pendingUsageTtft: number | undefined;
	#pendingUsageTimestamp: number | undefined;
	#pendingReadUsageCallIds: string[] | undefined;
	#pendingUsageToolGroup: ToolCallGroupComponent | null = null;
	#pendingUsageElapsedMs: number | undefined;
	#turnStartedAt: number | undefined;
	readonly #turnUsage = new TurnUsageTally();
	#lastAssistantUsage: Usage | undefined;
	#servedModelTracker = new ServedModelTracker();
	#waitingPoll: ToolExecutionComponent | null = null;
	#todoSnapshot: ToolExecutionComponent | null = null;
	#expandables: Array<{ setExpanded(expanded: boolean): void }> = [];
	#expanded = false;
	#groupExpanded = false;
	#entryComponentsInProgress: Component[] | undefined;
	#entryComponents = new Map<string, Component[]>();

	readonly #deps: ChatTranscriptBuilderDeps;

	constructor(deps: ChatTranscriptBuilderDeps) {
		this.#deps = deps;
		this.container.setToolActivityVisible(!displayPreferences.hideToolActivity);
	}

	/** Whether the transcript currently holds any rendered rows. */
	get isEmpty(): boolean {
		return this.container.children.length === 0;
	}

	/** Discard all components and rebuild the whole transcript from `entries`. */
	rebuild(entries: TranscriptEntry[]): void {
		this.reset();
		for (const entry of entries) this.#appendEntry(entry);
		// Flush the trailing turn's usage row only once its tools are materialized
		// (a read whose result has not arrived stays pending); otherwise the row
		// would sit above its tools. The drain happens here at the end of the pass.
		if (this.#readArgs.size === 0 && this.#pendingTools.size === 0) this.#flushPendingUsage();
	}

	/** Append newly persisted entries without rebuilding already rendered rows. */
	append(entries: TranscriptEntry[]): void {
		for (const entry of entries) this.#appendEntry(entry);
		if (this.#readArgs.size === 0 && this.#pendingTools.size === 0) this.#flushPendingUsage();
	}

	/**
	 * Toggle tool-output expansion across every expandable component. Cards a
	 * TSP terminal collapsed or expanded locally mirror that into their own
	 * state, so this re-applies the transcript-wide state to every one of them
	 * even when it equals the previous value.
	 */
	setExpanded(expanded: boolean): void {
		this.#expanded = expanded;
		for (const component of this.#expandables) component.setExpanded(expanded);
	}

	get expanded(): boolean {
		return this.#expanded;
	}

	/** Toggle group rows independently of result expansion, including future groups. */
	setGroupExpanded(expanded: boolean): void {
		this.#groupExpanded = expanded;
		for (const component of this.#expandables) {
			if (component instanceof ToolCallGroupComponent) component.setGroupExpanded(expanded);
		}
	}

	/** Components owned or shared by an entry, including groups opened by earlier entries. */
	componentsForEntry(entryId: string): readonly Component[] {
		return this.#entryComponents.get(entryId) ?? [];
	}

	/** Displayed assistant slice, used to keep shared-group selection apart from later prose. */
	assistantSegmentForComponent(component: Component): Extract<AgentMessage, { role: "assistant" }> | undefined {
		return this.#assistantSegments.get(component);
	}

	/** Rendered row where a persisted entry begins, after the container has painted once. */
	rowForEntry(entryId: string): number | undefined {
		let firstRow: number | undefined;
		for (const component of this.#entryComponents.get(entryId) ?? []) {
			const row = this.container.getChildStartRow(component);
			if (row !== undefined && (firstRow === undefined || row < firstRow)) firstRow = row;
		}
		return firstRow;
	}

	/** Tear down components (sealing pending spinners) and clear build state. */
	reset(): void {
		for (const pending of this.#pendingTools.values()) pending.seal();
		this.#pendingTools.clear();
		this.#readArgs.clear();
		this.#readGroup = null;
		this.#toolGroup = null;
		this.#pendingUsage = undefined;
		this.#pendingUsageDuration = undefined;
		this.#pendingUsageTtft = undefined;
		this.#pendingUsageTimestamp = undefined;
		this.#pendingReadUsageCallIds = undefined;
		this.#pendingUsageToolGroup = null;
		this.#pendingUsageElapsedMs = undefined;
		this.#turnStartedAt = undefined;
		this.#turnUsage.reset();
		this.#lastAssistantUsage = undefined;
		this.#servedModelTracker = new ServedModelTracker();
		this.#waitingPoll = null;
		this.#todoSnapshot = null;
		this.#expandables = [];
		this.#entryComponents.clear();
		this.container.dispose();
		this.container.clear();
	}

	dispose(): void {
		this.reset();
	}

	/** Record shared groups as well as newly mounted components for selection and scrolling. */
	#appendEntry(entry: TranscriptEntry): void {
		const message = transcriptEntryMessage(entry);
		if (!message) return;
		const before = this.container.children.length;
		const components: Component[] = [];
		this.#entryComponentsInProgress = components;
		try {
			this.#appendChatMessage(message);
		} finally {
			this.#entryComponentsInProgress = undefined;
		}
		for (const component of this.container.children.slice(before)) {
			if (!components.includes(component)) components.push(component);
		}
		if (components.length > 0) this.#entryComponents.set(entry.id, components);
	}

	#trackExpandable(component: { setExpanded(expanded: boolean): void }): void {
		component.setExpanded(this.#expanded);
		this.#expandables.push(component);
	}

	/** Append assistant prose (a reply, a post-tool segment, or an `out://` reply write) with the transcript's display preferences. */
	#mountProse(component: AssistantMessageComponent): void {
		component.setImagesVisible(displayPreferences.showImages);
		component.setToolResultImagesVisible(!displayPreferences.hideToolActivity);
		component.setTableChartsVisible(this.#deps.tableCharts !== false);
		this.#trackExpandable(component);
		this.container.addChild(component);
	}

	/** A `wait` showing all-running is displaced by the next `wait` call. */
	#resolveWaitingPoll(nextToolName?: string): void {
		const previous = this.#waitingPoll;
		if (!previous) return;
		this.#waitingPoll = null;
		if (nextToolName === "wait" && previous.isDisplaceableBlock() && this.container.canDisplaceBlock(previous)) {
			this.container.removeChild(previous);
		}
		previous.seal();
	}

	#resolveTodoSnapshot(nextToolName?: string): void {
		const previous = this.#todoSnapshot;
		if (!previous) return;
		if (!previous.isDisplaceableBlock()) {
			this.#todoSnapshot = null;
			return;
		}
		if (previous.canBeDisplacedBy(nextToolName)) {
			this.#todoSnapshot = null;
			this.container.removeChild(previous);
			previous.seal();
			return;
		}
		if (nextToolName !== undefined) return;
		this.#todoSnapshot = null;
		previous.seal();
	}

	#ensureReadGroup(): ReadToolGroupComponent {
		if (!this.#readGroup) {
			this.#readGroup = new ReadToolGroupComponent({
				showContentPreview: displayPreferences.readToolResultPreview,
			});
			this.#trackExpandable(this.#readGroup);
			this.container.addChild(this.#readGroup);
		}
		if (!this.#entryComponentsInProgress?.includes(this.#readGroup)) {
			this.#entryComponentsInProgress?.push(this.#readGroup);
		}
		return this.#readGroup;
	}

	#sealToolGroup(): void {
		this.#toolGroup?.seal();
		this.#toolGroup = null;
	}

	#ensureToolGroup(): ToolCallGroupComponent {
		if (!this.#toolGroup) {
			this.#toolGroup = new ToolCallGroupComponent({
				resolveTool: this.#deps.getTool,
				ui: this.#deps.ui,
				cwd: this.#deps.cwd,
				showImages: displayPreferences.showImages,
				showReadContentPreview: displayPreferences.readToolResultPreview,
			});
			this.#toolGroup.setGroupExpanded(this.#groupExpanded);
			this.#trackExpandable(this.#toolGroup);
			this.container.addChild(this.#toolGroup);
		}
		if (!this.#entryComponentsInProgress?.includes(this.#toolGroup)) {
			this.#entryComponentsInProgress?.push(this.#toolGroup);
		}
		return this.#toolGroup;
	}

	// Defer per-turn metrics until the turn's tool results have materialized.
	// Read-only invisible turns attach metrics to their group; other turns
	// keep the standalone row below their tool blocks.
	#flushPendingUsage(): void {
		if (!this.#pendingUsage) return;
		const usageAttached =
			this.#pendingReadUsageCallIds !== undefined &&
			(this.#pendingUsageToolGroup?.attachUsage(
				this.#pendingReadUsageCallIds,
				this.#pendingUsage,
				this.#pendingUsageDuration,
				this.#pendingUsageTtft,
				this.#pendingUsageTimestamp,
				this.#pendingUsageElapsedMs,
			) ||
				this.#readGroup?.attachUsage(
					this.#pendingReadUsageCallIds,
					this.#pendingUsage,
					this.#pendingUsageDuration,
					this.#pendingUsageTtft,
					this.#pendingUsageTimestamp,
					this.#pendingUsageElapsedMs,
				) ||
				false);
		if (!usageAttached) {
			this.#readGroup?.seal();
			this.#readGroup = null;
			this.#sealToolGroup();
			this.container.addChild(
				createUsageRowBlock(
					this.#pendingUsage,
					this.#pendingUsageDuration,
					this.#pendingUsageTtft,
					this.#pendingUsageTimestamp,
					this.#pendingUsageElapsedMs,
				),
			);
		}
		this.#pendingUsage = undefined;
		this.#pendingUsageDuration = undefined;
		this.#pendingUsageTtft = undefined;
		this.#pendingUsageTimestamp = undefined;
		this.#pendingReadUsageCallIds = undefined;
		this.#pendingUsageToolGroup = null;
		this.#pendingUsageElapsedMs = undefined;
	}

	#appendChatMessage(message: AgentMessage): void {
		if (message.role !== "toolResult") this.#flushPendingUsage();
		if (message.role !== "assistant" && message.role !== "toolResult") {
			this.#readGroup?.seal();
			this.#readGroup = null;
			this.#sealToolGroup();
		}
		switch (message.role) {
			case "assistant":
				this.#appendAssistantMessage(message);
				break;
			case "toolResult":
				this.#appendToolResult(message);
				break;
			case "user":
			case "developer": {
				// Only genuinely user-attributed prompts anchor the delta; a mid-run
				// agent-attributed `user` message (advisor tool-loop redirect) must not.
				if (message.role === "user" && message.attribution !== "agent") {
					this.#turnStartedAt = message.timestamp;
					this.#turnUsage.reset();
				} else if (message.role === "developer" && message.synthetic) {
					this.#turnUsage.reset();
					// A synthetic developer message initiates a fresh run (auto-
					// continue, /goal, approved plan): replay must not inherit the
					// preceding user prompt's timestamp, mirroring the live
					// agent_start clear. Same-turn continuation reminders (todo, plan)
					// are persisted developer messages WITHOUT the synthetic marker,
					// so their anchor survives the rebuild.
					// A deliberate operator action (`.`, `c` continue shortcut) is the turn's
					// own prompt: anchor the delta to it instead of clearing.
					if (message.userInitiated) this.#turnStartedAt = message.timestamp;
					else this.#turnStartedAt = undefined;
				}
				// A user prompt closes the poll-displacement window, same as the live path.
				if (message.role === "user") this.#resolveWaitingPoll();
				if (message.role === "user") this.#resolveTodoSnapshot();
				const userText = message.role === "user" ? textContent(message.content) : "";
				if (userText) {
					const isSynthetic = message.role === "developer" ? true : (message.synthetic ?? false);
					// Synthetic (agent-attributed) inputs — chiefly the advisor's `Session
					// update` replay dumps — can be hundreds of KiB of Markdown each.
					// Rendering their full body on cold open blocked the TUI (issue #6308);
					// collapse them behind a compact summary that builds Markdown only on
					// ctrl+o expand. Real user prompts stay fully rendered.
					if (isSynthetic) {
						const collapsed = new CollapsedSyntheticMessageComponent(userText);
						this.#trackExpandable(collapsed);
						this.container.addChild(collapsed);
					} else {
						this.container.addChild(
							new UserMessageComponent(userText, {
								liveSteered: message.role === "user" && message.liveSteered === true,
								timestamp: message.timestamp,
								images: imageContent(message.content),
							}),
						);
					}
				}
				break;
			}
			case "bashExecution": {
				const component = new BashExecutionComponent(message.command, this.#deps.ui, message.excludeFromContext);
				if (message.output) component.appendOutput(message.output);
				component.setComplete(message.exitCode, message.cancelled, {
					truncation: message.meta?.truncation,
					artifactError: message.meta?.artifactError,
					images: message.images,
					showImages: displayPreferences.showImages,
				});
				this.container.addChild(component);
				break;
			}
			case "pythonExecution": {
				const component = new EvalExecutionComponent(message.code, this.#deps.ui, message.excludeFromContext);
				if (message.output) component.appendOutput(message.output);
				component.setComplete(message.exitCode, message.cancelled, {
					truncation: message.meta?.truncation,
					artifactError: message.meta?.artifactError,
				});
				this.container.addChild(component);
				break;
			}
			case "hookMessage":
			case "custom":
				// A directly-invoked `/skill:` custom prompt is the run's initiator
				// (user attribution), so it seeds the prompt→yield delta like a user
				// message does.
				if (message.role === "custom" && isUserTurnInitiator(message as CustomMessage)) {
					this.#turnStartedAt = message.timestamp;
					this.#turnUsage.reset();
				}
				this.#appendCustomMessage(message);
				break;
			case "compactionSummary": {
				const component = new CompactionSummaryMessageComponent(message);
				this.#trackExpandable(component);
				this.container.addChild(component);
				break;
			}
			case "branchSummary": {
				const component = new BranchSummaryMessageComponent(message);
				this.#trackExpandable(component);
				this.container.addChild(component);
				break;
			}
			case "fileMention": {
				// Indent one column to match the transcript's other rows (the viewer renders
				// body rows without an outer gutter; rows own their left pad).
				const block = buildFileMentionBlock(message.files, 1);
				if (block.children.length > 0) this.container.addChild(block);
				break;
			}
			default:
				message satisfies never;
		}
	}

	/** Prompt→yield wall time for the current turn, or undefined when unknown. */
	#turnElapsedMs(message: Extract<AgentMessage, { role: "assistant" }>): number | undefined {
		return turnElapsedMs(this.#turnStartedAt, message);
	}

	#appendAssistantMessage(message: Extract<AgentMessage, { role: "assistant" }>): void {
		const hideThinkingBlock = this.#deps.hideThinkingBlock?.() ?? false;
		const proseOnlyThinking = this.#deps.proseOnlyThinking ? this.#deps.proseOnlyThinking() : true;
		const expandThinkingBlocks = this.#deps.expandThinkingBlocks?.() ?? false;
		const timeline = splitAssistantMessageToolTimeline(message);
		const assistantComponent = new AssistantMessageComponent(
			timeline.beforeTools,
			hideThinkingBlock,
			() => this.#deps.requestRender(),
			this.#deps.getMessageRenderer ? undefined : [], // placeholder for thinkingRenderers
			this.#deps.ui.imageBudget,
			proseOnlyThinking,
			this.#deps.linkTargets,
			expandThinkingBlocks,
		);
		assistantComponent.pickReactionTarget(this.container.children);
		this.#assistantSegments.set(assistantComponent, timeline.beforeTools);
		this.#mountProse(assistantComponent);
		let lastAssistantComponent = assistantComponent;

		if (displayPreferences.cacheMissMarker) {
			const invalidation = detectCacheInvalidation(this.#lastAssistantUsage, message.usage);
			if (invalidation) assistantComponent.setCacheInvalidation(invalidation);
		}
		if (message.usage.cacheRead + message.usage.cacheWrite + message.usage.input > 0) {
			this.#lastAssistantUsage = message.usage;
		}
		assistantComponent.setServedModelMismatch(this.#servedModelTracker.check(message));

		const hasVisibleAssistantContent = assistantHasVisibleContent(timeline.beforeTools);
		if (hasVisibleAssistantContent) {
			// New visible turn content closes the current read run (mirrors rebuild).
			this.#readGroup?.seal();
			this.#readGroup = null;
		}
		if (messageBreaksToolGroup(timeline.beforeTools)) this.#sealToolGroup();

		const errorPresentation = resolveAssistantErrorPresentation(message);
		const hasErrorStop = errorPresentation.kind === "full";
		const errorMessage = hasErrorStop ? errorPresentation.text : null;
		const appendAssistantSegment = (segment: Extract<AgentMessage, { role: "assistant" }> | undefined) => {
			if (!segment || !assistantHasVisibleContent(segment)) return;
			this.#readGroup?.seal();
			this.#readGroup = null;
			if (messageBreaksToolGroup(segment)) this.#sealToolGroup();
			const component = new AssistantMessageComponent(
				segment,
				hideThinkingBlock,
				() => this.#deps.requestRender(),
				this.#deps.getMessageRenderer ? undefined : [],
				undefined,
				proseOnlyThinking,
				this.#deps.linkTargets,
				expandThinkingBlocks,
			);
			this.#mountProse(component);
			this.#assistantSegments.set(component, segment);
			lastAssistantComponent = component;
		};

		for (const content of message.content) {
			if (content.type !== "toolCall") continue;
			this.#resolveWaitingPoll(content.name);

			const builtIn = this.#deps.isBuiltInTool?.(content.name) ?? true;
			const afterToolSegment = timeline.afterToolCalls.get(content.id);
			if (
				!displayPreferences.groupConsecutiveTools &&
				content.name === "read" &&
				readArgsCollapseIntoGroup(content.arguments)
			) {
				this.#sealToolGroup();
				if (hasErrorStop && errorMessage) {
					const group = this.#ensureReadGroup();
					group.updateArgs(content.arguments, content.id);
					group.updateResult(
						{ content: [{ type: "text", text: errorMessage }], isError: true },
						false,
						content.id,
					);
				} else if (afterToolSegment) {
					const group = this.#ensureReadGroup();
					group.updateArgs(content.arguments, content.id);
					this.#pendingTools.set(content.id, group);
				} else {
					const normalizedArgs = normalizeToolArgs(content.arguments);
					this.#readArgs.set(content.id, normalizedArgs);
				}
				appendAssistantSegment(afterToolSegment);
				continue;
			}

			this.#readGroup?.seal();
			this.#readGroup = null;
			const replyWrite = builtIn && isReplyWrite(content.name, content.arguments) === true;
			if (!replyWrite && displayPreferences.groupConsecutiveTools && shouldGroupToolCall(content.name, builtIn)) {
				const group = this.#ensureToolGroup();
				group.beginCall(content.name, content.arguments, content.id);
				if (hasErrorStop && errorMessage) {
					group.updateResult(
						{ content: [{ type: "text", text: errorMessage }], isError: true },
						false,
						content.id,
					);
				} else {
					this.#pendingTools.set(content.id, group);
				}
				appendAssistantSegment(afterToolSegment);
				continue;
			}
			this.#sealToolGroup();
			let component: ToolExecutionHandle;
			if (replyWrite) {
				const reply = new ReplyWriteComponent({
					requestRender: () => this.#deps.requestRender(),
					imageBudget: this.#deps.ui.imageBudget,
					linkTargets: this.#deps.linkTargets,
				});
				reply.updateArgs(content.arguments);
				reply.setArgsComplete();
				this.#mountProse(reply);
				component = reply;
			} else {
				const card = new ToolExecutionComponent(
					content.name,
					content.arguments,
					{
						useBuiltInRenderer: builtIn,
						// Stable ids and Kitty placeholder cells keep images anchored
						// while the transcript viewport scrolls and reflows.
						showImages: displayPreferences.showImages,
					},
					this.#deps.getTool?.(content.name),
					this.#deps.ui,
					this.#deps.cwd,
					content.id,
				);
				this.#trackExpandable(card);
				this.container.addChild(card);
				component = card;
			}

			if (hasErrorStop && errorMessage) {
				component.updateResult(
					{ content: [{ type: "text", text: errorMessage }], isError: true },
					false,
					content.id,
				);
			} else {
				this.#pendingTools.set(content.id, component);
			}
			appendAssistantSegment(afterToolSegment);
		}
		const turnUsage = this.#turnUsage.add(message, this.#turnStartedAt);
		if (turnUsage) lastAssistantComponent.setTurnUsage(turnUsage);

		this.#pendingUsage =
			displayPreferences.showTokenUsage && assistantUsageIsBilled(message.usage) ? message.usage : undefined;
		this.#pendingUsageDuration = message.duration;
		this.#pendingUsageTtft = message.ttft;
		this.#pendingUsageTimestamp = message.timestamp;
		this.#pendingReadUsageCallIds = this.#pendingUsage ? groupedReadUsageCallIds(message) : undefined;
		this.#pendingUsageToolGroup = this.#pendingReadUsageCallIds ? this.#toolGroup : null;
		this.#pendingUsageElapsedMs =
			this.#pendingUsage && displayPreferences.showTurnTime ? this.#turnElapsedMs(message) : undefined;
	}

	#appendToolResult(message: Extract<AgentMessage, { role: "toolResult" }>): void {
		const pending = this.#pendingTools.get(message.toolCallId);
		if (pending) this.#entryComponentsInProgress?.push(pending);
		const isReadGroupResult =
			message.toolName === "read" &&
			(pending instanceof ReadToolGroupComponent ||
				(!pending && (this.#readArgs.has(message.toolCallId) || !displayPreferences.groupConsecutiveTools)));
		if (isReadGroupResult) {
			let component = pending;
			if (!component) {
				const group = this.#ensureReadGroup();
				const args = this.#readArgs.get(message.toolCallId);
				if (args) group.updateArgs(args, message.toolCallId);
				component = group;
			}
			component.updateResult(message, false, message.toolCallId);
			this.#pendingTools.delete(message.toolCallId);
			this.#readArgs.delete(message.toolCallId);
			return;
		}
		for (const reply of toolResultReplies(message.details)) {
			this.#mountProse(
				new AssistantMessageComponent(
					replyDisplayMessage(reply),
					false,
					() => this.#deps.requestRender(),
					[],
					this.#deps.ui.imageBudget,
					true,
					this.#deps.linkTargets,
				),
			);
		}
		if (!pending) return;
		pending.updateResult(message, false, message.toolCallId);
		if (
			message.toolName === "read" &&
			pending === this.#toolGroup &&
			displayPreferences.showImages &&
			!displayPreferences.hideToolActivity &&
			message.content.some(part => part.type === "image")
		) {
			this.#sealToolGroup();
		}
		this.#pendingTools.delete(message.toolCallId);
		if (message.toolName === "wait" && pending instanceof ToolExecutionComponent && pending.isDisplaceableBlock()) {
			this.#waitingPoll = pending;
		} else if (
			message.toolName === "todo" &&
			pending instanceof ToolExecutionComponent &&
			pending.canBeDisplacedBy("todo")
		) {
			// A successful todo result supersedes the prior live snapshot. Failed
			// follow-ups return false from canBeDisplacedBy("todo"), so the
			// last-good panel stays on screen.
			this.#resolveTodoSnapshot("todo");
			this.#todoSnapshot = pending;
		}
	}
	#appendCustomMessage(message: Extract<AgentMessage, { role: "custom" | "hookMessage" }>): void {
		if (!message.display) return;
		if (message.customType === "async-result") {
			const component = buildAsyncResultBlock(message);
			this.container.addChild(component);
			return;
		}
		if (message.customType === LSP_LATE_DIAGNOSTIC_MESSAGE_TYPE) {
			const details = (message as CustomMessage<{ files?: LateDiagnosticsFile[] }>).details;
			// Native: into the edit/write frames they belong to; the rest stand alone.
			const files = routeLateDiagnostics(this.container.children, details?.files ?? []);
			if (files.length === 0) return;
			const component = new LateDiagnosticsMessageComponent(files);
			this.#trackExpandable(component);
			this.container.addChild(component);
			return;
		}
		if (message.customType === COLLAB_PROMPT_MESSAGE_TYPE) {
			this.container.addChild(new CollabPromptMessageComponent(message as CustomMessage<CollabPromptDetails>));
			return;
		}
		if (message.customType === SKILL_PROMPT_MESSAGE_TYPE) {
			const component = new SkillMessageComponent(message as CustomMessage<SkillPromptDetails>);
			this.#trackExpandable(component);
			this.container.addChild(component);
			return;
		}
		if (
			message.customType === "irc:incoming" ||
			message.customType === "irc:autoreply" ||
			message.customType === "irc:relay" ||
			message.customType === "irc:workpool"
		) {
			this.container.addChild(buildIrcMessageCard(message, () => this.#expanded));
			return;
		}
		if (message.customType === "advisor") {
			const details = (message as CustomMessage<AdvisorMessageDetails>).details;
			const card = createAdvisorMessageCard(details, () => this.#expanded, theme);
			// Tracked so a transcript-wide toggle also clears a per-card native toggle.
			this.#trackExpandable(card);
			this.container.addChild(card);
			return;
		}
		if (message.customType === LAUNCH_COMPLETION_MESSAGE_TYPE) {
			this.container.addChild(buildLaunchCompletionBlock(message));
			return;
		}
		if (message.customType === BACKGROUND_TAN_DISPATCH_MESSAGE_TYPE) {
			this.container.addChild(createBackgroundTanDispatchBlock(message as CustomMessage<unknown>));
			return;
		}
		const handoffComponent = createHandoffSummaryMessageComponent(message as CustomMessage<unknown>, this.#expanded);
		if (handoffComponent) {
			this.#trackExpandable(handoffComponent);
			this.container.addChild(handoffComponent);
			return;
		}
		const component = new CustomMessageComponent(
			message as CustomMessage<unknown>,
			this.#deps.getMessageRenderer?.(message.customType),
		);
		this.#trackExpandable(component);
		this.container.addChild(component);
	}
}
