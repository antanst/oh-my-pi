# Proposal

## Why

Long runs of tool calls fill the transcript with one card per call. The only current
controls are `display.hideToolActivity`, which removes all tool activity, and local
extensions that can compact single cards but cannot merge them. A built-in grouping
option gives a compact transcript without losing per-call detail.

## What Changes

- Add the setting `display.groupConsecutiveTools` (boolean, default `false`) under
  Appearance → Display.
- When enabled, consecutive calls of built-in tools render as one group card per run.
  `read` keeps its existing read-group behavior and is excluded.
- The group card updates in place as calls arrive. Collapsed, it shows the latest call
  summary plus a count (`$ last command +3`). Expanded with Ctrl+O, it shows one row
  per call in the run.
- A run breaks on visible assistant content (text, thinking, image) or on a tool call
  that does not join the group. A run may continue across consecutive assistant
  completions while nothing breaks it.
- History rendering and live streaming use the same grouping rule.
- Model context is unchanged. All calls and results still go to the model.
- `display.hideToolActivity` keeps precedence: hidden tool activity stays hidden.
- No breaking changes. The option is off by default.

## Capabilities

### New Capabilities

- `tool-transcript-grouping`: transcript rendering for runs of consecutive tool calls,
  including the group card shape, the run-breaking rule, and the setting that enables
  it.

### Modified Capabilities

None.

## Impact

- `packages/tui/src/chat/chat-transcript-builder.ts`: history render path.
- `packages/tui/src/chat/`: new generic tool-call group component beside
  `read-tool-group.ts`.
- `packages/coding-agent/src/modes/controllers/event-controller.ts`: live render path.
- `packages/coding-agent/src/modes/settings.ts`: new `display.*` setting.
- Settings documentation and tests for grouping, run breaks, expansion, and the
  disabled default.
