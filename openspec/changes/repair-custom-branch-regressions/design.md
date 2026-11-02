## Context

The review compares branch `custom` at `7ef5ba4e12` with official release v18.14.1 (`c29f7c56f5530d805bb2887ade964aa55970d8e1`). It identifies 17 branch-introduced defects. Runtime probes establish the approval wait, missing built-in output, lost partial-result updates, failed background state, ordering defects, key conflict, viewer controls, native visibility, wrapping, and updater hazards. The existing focused suite passes 222 tests but does not cover these failures.

The group currently calls only renderer methods on a live tool. Built-ins such as bash instead use the registry and context assembled by `ToolExecutionComponent`. Streaming and replay also treat an entire assistant message as a boundary, rather than processing its ordered content. The updater registers destructive cleanup before rejecting a dirty tree and selects from all local tags.

## Goals / Non-Goals

Goals:
- Repair all 17 findings, starting with data loss, approval blocking, and hidden output.
- Keep opt-in grouping, separate row/output controls, and unchanged session history.
- Preserve existing renderer staging, safe fallbacks, image handling, and native visibility.
- Keep local updates safe and based only on official upstream release objects.
- Verify real runtime behavior and commit focused changes on `custom`.

Non-goals:
- Repair inherited upstream defects or redesign the transcript system.
- Change the accepted version-only updater skip policy.
- Add dependencies, settings, session migrations, or compatibility aliases.
- Deploy, push, or publish changes.

## Decisions

### Keep grouping and reuse established rendering

Removing grouping would avoid the defects but remove requested branch behavior. A second renderer pipeline would duplicate fallback and context logic. Reuse `ToolExecutionComponent` for per-entry result presentation, with a narrow result-only mode if needed. `ToolCallGroupOptions` may accept optional `ui`, `cwd`, and `showImages` values; existing callers and tests remain valid. Production constructors pass their real context. Preserve `beginCall`, `updateResult`, `removeEntry`, `setExpanded`, and `setGroupExpanded` APIs.

Partial frames keep entries pending. A group that has reached a run boundary stays mutable until pending calls settle. Cancellation seals only the affected entry; turn cleanup preserves running background siblings. Native descriptions use the same hidden-state helper and complete result composition as ordinary tool cards. Renderer-owned result headers retain metadata, status, and controls; only duplicated command/code inputs are omitted. Width-aware summary components reserve space for count and failure markers; result components keep their existing dimensions.

### Process boundaries in content order

Live streaming must process each newly visible boundary once. Repeated cumulative prefixes are not new boundaries. Replay helpers and the shared builder use the existing assistant timeline splitter. Read and non-read groups close each other at the actual boundary. Retry cleanup removes only the obsolete call ID. Background completion derives the final error state from the job rather than its successful launch frame.

Builder append batches are transport boundaries, not visible boundaries. Preserve open groups across batches and maintain outline ownership when one rendered component spans several entries. Mixed entries expose their rendered assistant slices so shared groups and trailing prose have separate selectable targets without changing persisted messages or rewind IDs.

### Separate the controls

Use Alt+X as the default group action. Ctrl+X remains available to autoresearch. The main input handler does not consume a group action when grouping is disabled. Agent, copy, and rewind viewers route the configured action through a builder `setGroupExpanded` method. Their output controls remain separate. Update current documentation, not archived historical specifications or released changelogs.

### Protect local updates

Reject tracked edits before installing cleanup traps. Resolve release names and objects from upstream rather than the mixed local tag namespace. Support lightweight and annotated tags without overwriting local tags. Clear the inherited cross-target setting for the local build. Handle HUP, INT, and TERM through a failing exit that restores only the generated file after the clean-tree guard. Use POSIX shell constructs.

### Preflight archives before synchronization

Both archive command and skill calculate and inspect the destination before modifying main specs. Keep the immediate pre-move check for a destination created after preflight. Bulk archive already has early preflight and needs no unrelated rewrite.

## Implementation ownership

- Updater: `scripts/local-update.sh` and isolated updater regression tests; findings 1, 14, 15, 16.
- Group renderer: `tool-call-group.ts`, shared `tool-execution.ts` result mode, and a new TUI regression file; findings 3, 4, 11, 13.
- Live controller: `event-controller.ts` and a dedicated live regression file; findings 2, 5, 6 live, 7, 8. Pass real UI/cwd/image options at group construction.
- Replay/viewers: `ui-helpers.ts`, `chat-transcript-builder.ts`, outline and shared viewers, and dedicated regression tests; findings 6 replay, 10, 12. Pass real group context and own builder group-state APIs.
- Input controls: `input-controller.ts`, `app-keybindings.ts`, and focused input tests; finding 9. The parent updates current docs after verification.
- Parent: archive prompts, existing shared grouping tests if integration changes them, OpenSpec artifacts, changelogs/docs, final verification, and commits.

Agents write regression tests before their fixes and do not run builds, lint, tests, or formatters while edits are in flight. The observed failures establish the prior behavior. The parent runs the integrated checks after all source changes finish.

## Risks / Trade-offs

- Reusing full tool components can accidentally duplicate call headers or trigger hidden preview work. Verify output-only rendering with actual built-in tools, custom staging, and partial frames.
- Incremental groups can span outline entries. Verify selection ownership as well as visible grouping.
- Shell signal handling differs from normal exit handling. Use disposable local repositories and a controlled build process; never run the updater against the user's installation during tests.
- Alt+X changes the default shortcut. Keep explicit user mappings and document the new default.
- Archive preflight prevents known collisions but cannot roll back synchronization if a later race creates the destination. The second guard prevents overwrites and reports that state.

## Verification

Run the focused existing suite plus new behavior regressions, type checks through `bun check`, and relevant format/lint checks once changes are integrated. Exercise the real terminal surface for grouped output, expansion, width, and final failures. Use temporary local Git remotes and build fixtures to exercise updater target selection, preservation, installation, and signals without network or installation side effects. Validate the OpenSpec change, review the implementation against every task, then commit. Remove throwaway runtime probes and record only observed evidence.

### Observed results

- The final focused run passes 373 tests across 28 files, with zero failures.
- `bun --cwd=packages/tui check` and `bun --cwd=packages/coding-agent check` pass lint, formatting, and type checks. Unchanged files still produce warnings.
- `dash -n scripts/local-update.sh` and `shellcheck --shell=sh scripts/local-update.sh` pass. Disposable Git repositories exercise dirty-tree rejection, official release selection, stale-build protection, and signal cleanup.
- The real terminal at 80 and 40 columns shows grouped results without repeated command input. Alt+X, Ctrl+O, late failure, and hide/restore preserve the expected content.
- Six native result descriptions preserve empty counts, timeout notes, and short errors on data-first and fallback hosts. Data-first descriptions also retain result tones.
- Four disposable archive scenarios verify initial collisions, already-dated names, successful synchronization and movement, and the late-collision guard.
- Strict OpenSpec validation passes. The updater/archive, renderer, live controls, and replay/viewer reviews report no remaining blocking findings.
- Temporary runtime probes are removed. No real installation, deployment, push, complete repository suite, Rust suite, or native graphical frontend run is performed.
