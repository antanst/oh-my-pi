import { describe, expect, it, vi } from "bun:test";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ExtensionRuntime, loadExtensionFromFactory } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import { cfgDisplayGroupConsecutiveTools } from "@oh-my-pi/pi-coding-agent/modes/settings";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { KeybindingsManager, type KeybindingsConfig } from "@oh-my-pi/pi-tui/app-keybindings";
import { CustomEditor } from "@oh-my-pi/pi-tui/prompt/custom-editor";
import { getEditorTheme } from "@oh-my-pi/pi-tui/theme/tui-adapters";

type InputListener = (data: string) => { consume?: boolean; data?: string } | undefined;

/** Drive controller listeners before the real editor, as terminal input dispatch does. */
async function createHarness(grouping: boolean, bindings: KeybindingsConfig = {}) {
	const shortcuts: string[] = [];
	const runtime = new ExtensionRuntime();
	const extension = await loadExtensionFromFactory(
		pi => {
			for (const key of ["ctrl+x", "alt+x", "alt+j"] as const) {
				pi.registerShortcut(key, {
					handler: () => {
						shortcuts.push(key);
					},
				});
			}
		},
		process.cwd(),
		new EventBus(),
		runtime,
		"group-shortcut-test",
	);
	const sessionManager = SessionManager.inMemory(process.cwd());
	const runner = new ExtensionRunner([extension], runtime, process.cwd(), sessionManager, {} as ModelRegistry);
	const editor = new CustomEditor(getEditorTheme());
	const listeners: InputListener[] = [];
	const settings = Settings.isolated();
	cfgDisplayGroupConsecutiveTools.set(settings, grouping);
	const ctx = {
		editor,
		settings,
		session: { extensionRunner: runner },
		keybindings: KeybindingsManager.inMemory(bindings),
		toolGroupExpanded: false,
		toolOutputExpanded: false,
		chatContainer: { children: [] },
		dictationSpaceHold: () => undefined,
		canFollowUpBtw: () => false,
		canCopyBtw: () => false,
		ui: {
			addInputListener: (listener: InputListener) => listeners.push(listener),
			addStartListener: () => {},
			getFocused: () => editor,
			hasOverlay: () => false,
			requestRender: vi.fn(),
			terminal: { write: () => {} },
		},
		showStatus: () => {},
	} as unknown as InteractiveModeContext;
	new InputController(ctx).setupKeyHandlers();
	return {
		ctx,
		shortcuts,
		/** Preserve listener consumption before forwarding a key to extension handlers. */
		press(data: string) {
			for (const listener of listeners) {
				const result = listener(data);
				if (result?.consume) return;
				data = result?.data ?? data;
			}
			editor.handleInput(data);
		},
	};
}

describe("group shortcuts and extension dispatch", () => {
	for (const grouping of [false, true]) {
		it(`preserves extension Ctrl+X with grouping ${grouping}`, async () => {
			const h = await createHarness(grouping);
			h.press("\x18");
			expect(h.shortcuts).toEqual(["ctrl+x"]);
			expect(h.ctx.toolGroupExpanded).toBe(false);
			expect(h.ctx.toolOutputExpanded).toBe(false);
		});
	}

	it("leaves Alt+X to extensions until grouping is enabled and keeps Ctrl+O independent", async () => {
		const h = await createHarness(false);
		h.press("\x1bx");
		expect(h.shortcuts).toEqual(["alt+x"]);
		expect(h.ctx.toolGroupExpanded).toBe(false);
		cfgDisplayGroupConsecutiveTools.set(h.ctx.settings, true);
		h.press("\x1bx");
		expect(h.shortcuts).toEqual(["alt+x"]);
		expect(h.ctx.toolGroupExpanded).toBe(true);
		expect(h.ctx.toolOutputExpanded).toBe(false);
		h.press("\x0f");
		expect(h.ctx.toolOutputExpanded).toBe(true);
		expect(h.ctx.toolGroupExpanded).toBe(true);
		h.press("\x1bx");
		expect(h.ctx.toolGroupExpanded).toBe(false);
		expect(h.ctx.toolOutputExpanded).toBe(true);
	});

	it("honors configured group keys without consuming them while grouping is disabled", async () => {
		const h = await createHarness(false, { "app.tools.toggleGroupExpansion": ["alt+j"] });
		h.press("\x1bj");
		expect(h.shortcuts).toEqual(["alt+j"]);
		expect(h.ctx.toolGroupExpanded).toBe(false);
		cfgDisplayGroupConsecutiveTools.set(h.ctx.settings, true);
		h.press("\x1bj");
		expect(h.ctx.toolGroupExpanded).toBe(true);
		h.press("\x1bx");
		h.press("\x18");
		expect(h.shortcuts).toEqual(["alt+j", "alt+x", "ctrl+x"]);
		expect(h.ctx.toolGroupExpanded).toBe(true);
		expect(h.ctx.toolOutputExpanded).toBe(false);
	});
});
