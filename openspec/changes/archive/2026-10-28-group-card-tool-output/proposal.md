# Proposal

## Why

With `display.groupConsecutiveTools: true`, group cards render call summaries only and never call a tool's `renderResult`. The global tool-output toggle (Ctrl+O) therefore cannot reveal any result inside a group card: staged renderers such as the user's `quiet-tools` extension show nothing at all, and collapsed cards end in a bare dim `+N` that reads like a truncated command. Grouping shipped after those renderers were written, so their staged output contract silently stopped working.

## What Changes

- Group cards store each entry's call arguments and result, and render results through the tool's `renderResult` renderer.
- The host's tool-output expansion flag (`ctx.toolOutputExpanded`, toggled by Ctrl+O) now also applies to group cards:
  - Collapsed: the card shows the latest call summary followed by that call's rendered result.
  - Row-expanded (Ctrl+X): each call row is followed by its rendered result.
- Output staging stays inside each renderer (extension renderers apply their hidden/tail/full stages; native renderers use their expanded form). The group card only gates whether results render.
- With tool-output expansion off, group cards render exactly as today (summaries, `+N` count, error marks) — no visible change.
- Composes with the existing "tool output expansion is separate" rule: collapse state and row structure stay independent of Ctrl+O; only result rendering follows it.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `tool-transcript-grouping`: an additive requirement defines when grouped cards render results. Existing requirements are unchanged — the old separation scenario's stated behavior (collapse state unaffected by Ctrl+O) still holds.

## Impact

- `packages/tui/src/chat/tool-call-group.ts` — entries must retain args and results; rendering restructures from one flat text node to per-entry blocks; `setExpanded` stores the flag instead of ignoring it.
- `packages/coding-agent/src/modes/controllers/event-controller.ts` and `packages/coding-agent/src/modes/utils/ui-helpers.ts`, `packages/tui/src/chat/chat-transcript-builder.ts` — propagate `toolOutputExpanded` to group cards on creation, toggle, and transcript rebuild (live and replay paths).
- Tests: `packages/coding-agent/src/test/tool-call-group.test.ts` gains output-rendering and gating cases; existing collapse/expansion tests must keep passing.
- No wire, session, or model-context changes — grouping stays display-only; results are already in history.
- Verification and rollout: build and test the tree, then install the locally built omp via `scripts/local-update.sh`.
