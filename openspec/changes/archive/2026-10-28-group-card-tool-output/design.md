# Design

## Context

See proposal.md — Why. Current state, verified in code:

- `ToolCallGroupComponent` (`packages/tui/src/chat/tool-call-group.ts`) keeps entries of `{toolCallId, toolName, summary, status, errorText}` and renders through a single `Text` node rebuilt in `#updateDisplay()`. `beginCall()` reduces args to a summary string; `updateResult()` records only status and a one-line error excerpt — the result payload is discarded, and `renderResult` is never invoked.
- The host's Ctrl+O flag (`ctx.toolOutputExpanded`) reaches every expandable transcript child via `setToolsExpanded()` (`input-controller.ts` ~2908) and is re-applied on card creation and transcript rebuild (`event-controller.ts`, `ui-helpers.ts`). `ToolCallGroupComponent.setExpanded()` is a documented no-op.
- Ungrouped cards (`ToolExecutionComponent`) render results through the tool's `renderResult`; with `mergeCallAndResult`, the result component replaces the call line once a result exists. Staged renderers (the user's `quiet-tools` extension) implement hidden/tail/full stages keyed on flag flips they observe during host renders, and only work through this path today.
- The capability spec exists only in the complete, unarchived change `group-consecutive-tool-calls`.

## Goals / Non-Goals

**Goals:**

- Group cards honor the global tool-output toggle; results render through each tool's `renderResult`.
- Compose with both group modes: collapsed head (latest call + result) and Ctrl+X rows (every call + result).
- Byte-identical rendering when the toggle is off.
- Same behavior live, on toggle, and on transcript rebuild/resume.

**Non-Goals:**

- No session, wire, or model-context changes (grouping stays display-only).
- No output staging logic in the group component — staging stays inside renderers.
- No changes to read groups, extension-tool cards, `hideToolActivity`, or native ungrouped cards.

## Decisions

1. **Entries carry args and result; rendering moves to per-entry child components.**
   Results are width-dependent multi-line blocks; the current single `Text` node is rebuilt without width. A `Container` holding one child component per entry renders with the real terminal width each frame, exactly like `ToolExecutionComponent` does.
   *Alternative considered:* precompute result lines in `#updateDisplay()` with a cached width — rejected: stale on resize and duplicates `truncateToWidth`/`replaceTabs` hardening the renderers already own.
2. **Gate on `setExpanded()` (the host flag), not on renderer-internal stage counters.**
   The group stores the flag it currently ignores and renders results only when true. Each renderer decides the form: extension renderers apply their own hidden/tail/full stages, native renderers render their expanded form. `toggleToolActivityVisibility` already force-calls `setExpanded(false)` on groups, which keeps "hidden activity takes precedence" intact.
   *Alternative considered:* the group tracks flag flips to build the extension's 3-stage cycle itself — rejected: duplicates renderer policy in `pi-tui` and is wrong for native renderers that only know expanded/collapsed.
3. **Collapsed mode shows the latest call's result; row-expanded mode shows every result.**
   This preserves the existing information contract of each mode (collapsed = latest call + count; expanded = every call) and keeps the quiet-tools single-key flow working without Ctrl+X.
   *Alternative considered:* results only in row-expanded mode — rejected: forces a second keypress and defeats the purpose for the motivating extension.
4. **Late and sealed results:** `updateResult()` stores the payload and bumps the display version; rendering stays pure per frame. No new sealing semantics; the existing "late result after seal" contract carries over to results.
5. **Replay parity:** the transcript rebuilders (`chat-transcript-builder.ts`, `ui-helpers.ts`) must apply `ctx.toolOutputExpanded` to rebuilt group cards, mirroring the existing per-card `setExpanded` calls. The replay test harness covers parity.

## Risks / Trade-offs

- [Native renderers can produce tall blocks inside groups] → Same content the user opts into with Ctrl+O on ungrouped cards; native output already respects preview limits.
- [Extension renderers assumed `ToolExecutionComponent` was their only host] → `renderResult(result, options, theme, args)` is renderer-owned and unchanged; the group passes the same shape. Verified against `quiet-tools.ts`.
- [Per-frame `renderResult` calls for long runs] → Renderers are cheap string builders and `ToolExecutionComponent` already does this per card; child components rebuild only when an entry's state version changes.

## Migration Plan

- Display-only change behind two existing toggles whose defaults keep current behavior (`display.groupConsecutiveTools: false`, tool-output expansion collapsed), so no user sees a difference until they opt in.
- Rollback: revert the commit; no persisted state to migrate.

## Open Questions

- None.
