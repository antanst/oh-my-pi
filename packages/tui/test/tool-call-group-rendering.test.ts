import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { ToolCallGroupComponent, type ToolCallGroupOptions } from "../src/chat/tool-call-group";
import {
	settleWithJobFrame,
	stopSharedSpinnerTicker,
	ToolExecutionComponent,
	type ToolResultFrame,
} from "../src/chat/tool-execution";
import { TranscriptContainer } from "../src/chrome/transcript-container";
import { Text } from "../src/components/text";
import type { DescribeContext } from "../src/native/node";
import { ImageProtocol, setTerminalImageProtocol, TERMINAL } from "../src/terminal-capabilities";
import { initTheme } from "../src/theme";
import type { NativeToolView } from "../src/tools/renderer";
import type { Component } from "../src/tui";
import { visibleWidth } from "../src/utils";

const groups: ToolCallGroupComponent[] = [];
const imageProtocol = TERMINAL.imageProtocol;
const cx: DescribeContext = {
	cols: 80,
	reduceMotion: true,
	dark: true,
	supports: () => true,
	feature: () => false,
};

/** Keep every result component under the normal teardown path. */
function group(options: ToolCallGroupOptions = {}): ToolCallGroupComponent {
	const component = new ToolCallGroupComponent(options);
	groups.push(component);
	return component;
}

/** Return terminal text without changing renderer-owned indentation or line breaks. */
function rows(component: Component, width = 80): string[] {
	return component.render(width).map(row => Bun.stripANSI(row));
}

/** A real extension contract with controllable result staging. */
function customTool(renderResult: NonNullable<AgentTool["renderResult"]>): AgentTool {
	return {
		name: "custom",
		label: "Custom",
		description: "Grouped renderer fixture",
		parameters: Type.Object({}),
		execute: async () => ({ content: [] }),
		renderCall: () => new Text("custom call", 0, 0),
		renderResult,
	};
}

beforeAll(async () => {
	await initTheme(false);
});

afterEach(() => {
	for (const component of groups) component.dispose();
	groups.length = 0;
	stopSharedSpinnerTicker();
	setTerminalImageProtocol(imageProtocol);
});

describe("grouped result rendering", () => {
	it("uses the actual bash and eval registry with complete output context", () => {
		const component = group();
		component.setExpanded(true);
		component.setGroupExpanded(true);
		component.beginCall("bash", { command: "printf bash" }, "bash");
		component.updateResult(
			{
				content: [
					{ type: "text", text: "bash-first" },
					{ type: "text", text: "bash-last" },
				],
			},
			false,
			"bash",
		);
		component.beginCall("eval", { language: "py", code: "print(42)", title: "Calculate" }, "eval");
		component.updateResult(
			{
				content: [
					{ type: "text", text: "eval-first" },
					{ type: "text", text: "eval-last" },
				],
			},
			false,
			"eval",
		);
		const output = rows(component).join("\n");
		for (const line of ["bash-first", "bash-last", "eval-first", "eval-last"]) expect(output).toContain(line);
		// The grouped summary owns the input; result sections contain only output.
		expect(output.match(/printf bash/g)).toHaveLength(1);
	});

	it("omits registry-owned shell and eval inputs without dropping result metadata", () => {
		const cases = [
			{
				name: "bash",
				args: { command: "input_marker\ninput_tail" },
				result: {
					content: [{ type: "text", text: "output_marker" }],
					details: { exitCode: 7, wallTimeMs: 1250 },
					isError: true,
				},
			},
			{
				name: "eval",
				args: { language: "python", code: "input_marker = 1\ninput_tail = 2" },
				result: {
					content: [{ type: "text", text: "output_marker" }],
					details: {
						cells: [
							{
								index: 0,
								language: "python",
								code: "input_marker = 1\ninput_tail = 2",
								output: "output_marker",
								status: "error",
								durationMs: 1250,
								exitCode: 7,
							},
						],
					},
					isError: true,
				},
			},
		];
		for (const entry of cases) {
			const component = group();
			component.beginCall(entry.name, entry.args, "call");
			component.updateResult(entry.result, false, "call");
			component.setExpanded(true);
			const output = rows(component, 120);
			if (entry.name === "bash") expect(output[0]).toContain("input_marker");
			expect(output.slice(1).join("\n")).not.toContain("input_marker");
			expect(output.slice(1).join("\n")).not.toContain("input_tail");
			expect(output.slice(1).join("\n")).toContain("output_marker");
			const result = component.children.find(child => child instanceof ToolExecutionComponent);
			const described = result!.describe(cx);
			expect(described.k).toBe("tool");
			expect(JSON.stringify(described.c)).not.toContain("input_marker");
			if (described.k === "tool") {
				expect(JSON.stringify([described.p?.title, described.p?.target])).not.toContain("input_marker");
				if (entry.name === "bash") expect(described.p?.command).toBe(entry.args.command);
			}
			expect(JSON.stringify(described)).toContain("output_marker");
			expect(JSON.stringify(described)).toContain("1250");
			const standalone = new ToolExecutionComponent(entry.name, entry.args, {}, undefined, {
				requestRender() {},
				requestComponentRender() {},
				resetDisplay() {},
			});
			try {
				standalone.updateResult(entry.result);
				standalone.setExpanded(true);
				expect(rows(standalone, 120).join("\n")).toContain("input_marker");
			} finally {
				standalone.dispose();
			}
		}
	});

	it("preserves native glob counts and timeout notes without a result body", () => {
		for (const timedOut of [false, true]) {
			const component = group();
			component.beginCall("glob", { pattern: "**/*.missing" }, "call");
			component.updateResult(
				{
					content: [],
					details: { fileCount: 0, files: [], timedOut },
				},
				false,
				"call",
			);
			component.setExpanded(true);
			const result = component.children.find(child => child instanceof ToolExecutionComponent)!;
			expect(result.describe(cx)).toMatchObject({
				k: "tool",
				p: { meta: ["0 files"], note: timedOut ? "timed out" : undefined, tone: "warning", status: "done" },
				c: [],
			});
			const fallback = JSON.stringify(result.describe({ ...cx, supports: () => false }));
			expect(fallback).toContain("0 files");
			if (timedOut) expect(fallback).toContain("timed out");
		}
	});

	it("preserves short native errors stored only in result metadata", () => {
		const component = group();
		component.beginCall("glob", { pattern: "*" }, "call");
		component.updateResult(
			{
				content: [],
				details: { error: "result_error_marker" },
				isError: true,
			},
			false,
			"call",
		);
		component.setExpanded(true);
		const result = component.children.find(child => child instanceof ToolExecutionComponent)!;
		const described = result.describe(cx);
		expect(described).toMatchObject({ k: "tool", p: { tone: "error", status: "error" }, c: [] });
		if (described.k === "tool") expect(JSON.stringify(described.p?.meta)).toContain("result_error_marker");
		expect(JSON.stringify(result.describe({ ...cx, supports: () => false }))).toContain("result_error_marker");
	});

	it("preserves renderer-owned native heads, tones, and actions", () => {
		const head = [{ t: "result_head_marker", s: "strong" }];
		const actions = [{ id: "copy", label: "Copy" }];
		const tool = {
			...customTool(() => new Text("result", 0, 0)),
			describeResult(): NativeToolView {
				return { head, tone: "warning", tools: actions };
			},
		};
		const component = group({ resolveTool: () => tool });
		component.beginCall("custom", {}, "call");
		component.updateResult({ content: [], isError: true }, false, "call");
		component.setExpanded(true);
		const result = component.children.find(child => child instanceof ToolExecutionComponent)!;
		expect(result.describe(cx)).toMatchObject({
			k: "tool",
			p: { title: head, tone: "warning", status: "error", tools: actions },
			c: [],
		});
		expect(JSON.stringify(result.describe({ ...cx, supports: () => false }))).toContain("result_head_marker");
	});

	it("preserves custom staged rows and passes result details and partial state", () => {
		const tool = customTool((result, options) => {
			const details = result.details as { stage: string };
			const staged = ["  indented", `${details.stage}:${options.isPartial ? "partial" : "final"}`];
			return { render: () => staged, invalidate() {} };
		});
		const component = group({ resolveTool: () => tool });
		component.beginCall("custom", {}, "call");
		component.setExpanded(true);
		component.updateResult({ content: [], details: { stage: "download" } }, true, "call");
		expect(rows(component).slice(1)).toEqual(["  indented", "download:partial"]);
		expect(rows(component).filter(row => row.includes("custom call"))).toHaveLength(1);
		component.updateResult({ content: [], details: { stage: "complete" } }, false, "call");
		expect(rows(component).slice(1)).toEqual(["  indented", "complete:final"]);
	});

	it("retains custom staged result rows in the native description", () => {
		const staged = ["  native staged result"];
		const component = group({
			resolveTool: () => customTool(() => ({ render: () => staged, invalidate() {} })),
		});
		component.beginCall("custom", {}, "call");
		component.updateResult({ content: [{ type: "text", text: "raw result" }] }, false, "call");
		component.setExpanded(true);
		const result = component.children.find(child => child instanceof ToolExecutionComponent);
		const described = result!.describe(cx);
		const resultBody = described.c?.[0] as Component;
		expect(rows(resultBody)).toEqual(staged);
	});

	it("retains the result instance, forwards UI repaints, and accepts late results after sealing", () => {
		const repaintTargets: Component[] = [];
		let repaints = 0;
		const component = group({
			ui: {
				requestRender() {
					repaints++;
				},
				requestComponentRender(target) {
					repaintTargets.push(target);
				},
				resetDisplay() {},
			},
			cwd: "/workspace",
		});
		component.beginCall("bash", { command: "work" }, "call");
		component.setExpanded(true);
		component.updateResult({ content: [{ type: "text", text: "progress" }] }, true, "call");
		const result = component.children.find(child => child instanceof ToolExecutionComponent);
		expect(result).toBeInstanceOf(ToolExecutionComponent);
		result!.tickSpinner(2);
		expect(repaintTargets).toEqual([result!]);
		const version = component.getTranscriptBlockVersion();
		component.updateArgs({ command: "more work" }, "call");
		expect(component.getTranscriptBlockVersion()).toBeGreaterThan(version);
		expect(component.children).toContain(result!);
		component.seal();
		expect(repaints).toBeGreaterThan(0);
		component.updateResult({ content: [{ type: "text", text: "late completion" }] }, false, "call");
		expect(component.children).toContain(result!);
		expect(rows(component).join("\n")).toContain("late completion");
	});

	for (const failure of ["construction", "render"] as const) {
		it(`falls back to safe result text after custom ${failure} failure`, () => {
			const tool = customTool(() => {
				if (failure === "construction") throw new Error("renderer failed");
				return {
					render() {
						throw new Error("renderer failed");
					},
					invalidate() {},
				};
			});
			const component = group({ resolveTool: () => tool });
			component.beginCall("custom", {}, "call");
			component.setExpanded(true);
			component.updateResult({ content: [{ type: "text", text: "safe\u001b[2J result" }] }, false, "call");
			const output = component.render(80).join("\n");
			expect(Bun.stripANSI(output)).toContain("safe result");
			expect(output).not.toContain("\u001b[2J");
		});
	}

	it("keeps partial results mutable under transcript pressure until the final failure", () => {
		const component = group();
		component.setExpanded(true);
		component.beginCall("bash", { command: "work" }, "call");
		component.updateResult({ content: [{ type: "text", text: "progress" }] }, true, "call");
		component.finalize();
		const transcript = new TranscriptContainer();
		transcript.addChild(component);
		transcript.addChild(new Text("later\n".repeat(20), 0, 0));
		expect(transcript.peekFinalizedBatch(40, 1)).toBeUndefined();
		expect(component.isTranscriptBlockFinalized()).toBe(false);
		component.updateResult({ content: [{ type: "text", text: "terminal failure" }], isError: true }, false, "call");
		expect(component.isTranscriptBlockFinalized()).toBe(true);
		const batch = transcript.peekFinalizedBatch(40, 1);
		expect(batch).toBeDefined();
		expect(Bun.stripANSI(batch!.rows.join("\n"))).toContain("terminal failure");
		expect(Bun.stripANSI(batch!.rows.join("\n"))).toContain("✗");
	});

	it("seals a cancelled entry without finalizing its running siblings", () => {
		const component = group();
		component.setExpanded(true);
		component.setGroupExpanded(true);
		for (const id of ["cancelled", "running"]) {
			component.beginCall("bash", { command: id }, id);
			component.updateResult({ content: [{ type: "text", text: id }] }, true, id);
		}
		component.finalize();
		settleWithJobFrame(
			component,
			{
				content: [{ type: "text", text: "cancelled output" }],
				details: { async: { state: "cancelled", jobId: "cancelled" } },
			},
			"cancelled",
		);
		expect(component.isTranscriptBlockFinalized()).toBe(false);
		component.setExpanded(false);
		component.setExpanded(true);
		const results = component.children.filter(child => child instanceof ToolExecutionComponent);
		expect(results[0]!.isTranscriptBlockFinalized()).toBe(true);
		expect(results[1]!.isTranscriptBlockFinalized()).toBe(false);
		component.updateResult({ content: [{ type: "text", text: "finished" }] }, false, "running");
		expect(component.isTranscriptBlockFinalized()).toBe(true);
	});

	it("retains mounted native children while activity is hidden", () => {
		const component = group();
		component.beginCall("bash", { command: "work" }, "call");
		component.setExpanded(true);
		component.updateResult({ content: [{ type: "text", text: "retained result" }] }, false, "call");
		const visible = component.describe(cx);
		component.setToolActivityVisible(false);
		const hidden = component.describe(cx);
		expect(hidden?.p).toMatchObject({ hidden: true });
		expect(hidden?.c).toBe(visible?.c);
		expect(component.render(80)).toEqual([]);
		component.setToolActivityVisible(true);
		expect(component.describe(cx)?.p?.hidden).not.toBe(true);
		expect(rows(component).join("\n")).toContain("retained result");
	});

	it("keeps long summaries on one row with count and failure suffixes", () => {
		const component = group();
		component.beginCall("bash", { command: "long command ".repeat(50) }, "first");
		component.updateResult(
			{ content: [{ type: "text", text: "failure detail ".repeat(20) }], isError: true },
			false,
			"first",
		);
		component.beginCall("bash", { command: "latest command ".repeat(50) }, "last");
		for (const width of [5, 12, 24]) {
			const collapsed = rows(component, width);
			expect(collapsed).toHaveLength(1);
			expect(visibleWidth(collapsed[0]!)).toBeLessThanOrEqual(width);
			expect(collapsed[0]).toContain("+1");
			expect(collapsed[0]).toContain("✗");
		}
		expect(rows(component, 1)).toEqual(["✗"]);
		component.setGroupExpanded(true);
		const expanded = rows(component, 12);
		expect(expanded).toHaveLength(2);
		for (const row of expanded) expect(visibleWidth(row)).toBeLessThanOrEqual(12);
		expect(expanded[0]).toContain("✗");
	});

	it("does not apply the summary width limit to staged result rows", () => {
		const staged = ["  " + "result ".repeat(30), "last result row"];
		const component = group({ resolveTool: () => customTool(() => ({ render: () => staged, invalidate() {} })) });
		component.beginCall("custom", {}, "call");
		component.updateResult({ content: [] }, false, "call");
		component.setExpanded(true);
		expect(rows(component, 12).slice(1)).toEqual(staged);
	});

	it("preserves inline images and the image visibility setting", () => {
		setTerminalImageProtocol(ImageProtocol.Kitty);
		const result: ToolResultFrame = {
			content: [
				{
					type: "image",
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
					mimeType: "image/png",
				},
			],
		};
		for (const showImages of [true, false]) {
			const component = group({ showImages });
			component.beginCall("bash", { command: "plot" }, "call");
			component.updateResult(result, false, "call");
			component.setExpanded(true);
			expect(component.render(80).join("\n").includes("\u001b_G")).toBe(showImages);
		}
	});
});
