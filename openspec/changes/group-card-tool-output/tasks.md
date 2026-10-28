# Tasks

## 1. Prerequisite

- [x] 1.1 Archive the complete change `group-consecutive-tool-calls` so the `tool-transcript-grouping` capability exists under `openspec/specs/`; verify with `openspec list --specs` showing `tool-transcript-grouping` and `openspec validate --change group-card-tool-output` passing.

## 2. Group card result storage and rendering

- [x] 2.1 Extend group entries in `packages/tui/src/chat/tool-call-group.ts` to retain call args and the result payload: `beginCall()` stores args, `updateResult()` stores the full result instead of only status/error text; verify with `bun test packages/coding-agent/test/tool-call-group.test.ts` (existing collapse/count/error tests must still pass).
- [x] 2.2 Restructure group rendering to one child component per entry (per design decision 1): each entry renders its summary line plus, when the output flag is on, the tool's `renderResult(result, { expanded: true }, theme, args)` block; verify the collapsed head text, `+N` count, and `✗` error marks are byte-identical with the flag off by rendering the component at 80 and 120 widths in a test.
- [x] 2.3 Make `setExpanded()` store the tool-output flag and invalidate the card; keep `setGroupExpanded()` (Ctrl+X) semantics unchanged; verify composed behavior in a unit test: rows listed with results while expanded, head with latest result while collapsed.
- [x] 2.4 Propagate `ctx.toolOutputExpanded` to group cards in the replay/rebuild paths (`packages/tui/src/chat/chat-transcript-builder.ts`, `packages/coding-agent/src/modes/utils/ui-helpers.ts`); verify with the existing replay harness that a resumed session renders the same card as live.

## 3. Spec contract tests

- [x] 3.1 Add tests to `packages/coding-agent/test/tool-call-group.test.ts` covering the delta scenarios: collapsed+on shows latest summary then result; row-expanded+on shows every result; off shows summaries only; single-call run shows summary+result; late result after seal renders in place; verify all pass.
- [x] 3.2 Add a staging-preservation test with a fake tool whose `renderResult` returns a fixed staged block; assert the group shows that block unchanged (no reformatting, no truncation); verify it passes.
- [x] 3.3 Run `bun check` and the `packages/tui` + `packages/coding-agent` test suites; verify zero new failures.

## 4. Live verification

- [x] 4.1 In a real TUI session with `display.groupConsecutiveTools: true` and the `quiet-tools` extension, run a multi-call turn, then confirm on screen: Ctrl+O reveals staged output in the collapsed card and in Ctrl+X rows; a failing call keeps its `✗` mark; verify by observation (headless PTY capture).

## 5. Build and install

- [ ] 5.1 Build and install the new omp via `scripts/local-update.sh` (rebases onto the newest upstream release tag, `bun install`, `bun run build:native`, binary build, installs to `~/.local/bin/omp`); verify `~/.local/bin/omp --version` prints the new version and the version-boundary smoke (`omp --smoke-test`) passes.
