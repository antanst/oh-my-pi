# Tasks

## 1. Setting and display preferences

- [x] 1.1 Register `display.groupConsecutiveTools` (boolean, default `false`, Appearance →
  Display) in `packages/coding-agent/src/modes/settings.ts`, with a description that
  states the mid-session behavior. Verify that `Settings.isolated` applies the override
  and that the replay tests see the new grouping behavior.
- [x] 1.2 Add `groupConsecutiveTools` to `ChatTranscriptDisplayPreferences` and to the
  display-preferences effect in `settings.ts`. Verify with the builder parity test that
  applies the process preference and observes the grouped card.
- [x] 1.3 Add the setting row to the catalog in `docs/settings.md`. Verify the row text
  matches the registered description.

## 2. Group component

- [x] 2.1 Add `ToolCallGroupComponent` in `packages/tui/src/chat/tool-call-group.ts` with
  `updateArgs`, `updateResult`, `setExpanded`, `setToolActivityVisible`, `finalize`,
  `seal`, and `getTranscriptBlockVersion`. Verify with render tests for one call, two
  calls, many calls, expanded rows, the error marker, hidden activity, and a late
  result after the run is sealed.
- [x] 2.2 Add the call-summary adapter: custom `renderCall` first, `<name> <primary
  argument>` fallback; flatten to one line and truncate to width. Verify with tests for
  a custom renderer and the fallback.

## 3. Live render path

- [x] 3.1 Group live calls in `packages/coding-agent/src/modes/controllers/event-controller.ts`:
  start, join, update by `toolCallId`, finalize on break, seal at turn end. Verify with
  a live event test that two `tool_execution_start`/`end` pairs add one group card.
- [x] 3.2 Apply the break rule for assistant text or images, `read`, extension tools,
  and user messages; thinking does not break a run. Verify with tests for the text
  break, the thinking non-break, and the predicate excluding an unknown extension tool.

## 4. History render path

- [x] 4.1 Group saved calls in `packages/coding-agent/src/modes/utils/ui-helpers.ts` and
  `packages/tui/src/chat/chat-transcript-builder.ts` with the same predicate and break
  rule. Verify with replay tests that count components and check the card text.
- [x] 4.2 Add a parity test: the same messages through the transcript builder and
  through the replay path produce the same group card text and row count.

## 5. Integration

- [x] 5.1 PTY smoke with the source CLI (`bun --cwd=packages/coding-agent src/cli.ts`):
  enable the setting, resume a run of consecutive `bash` calls, confirm one card with
  the latest command and `+N`, and confirm Ctrl+O shows one row per call.
- [x] 5.2 In the same smoke, confirm that `display.hideToolActivity` hides the card and
  that a resumed session renders the same card. Text splitting is covered by the
  replay tests.
