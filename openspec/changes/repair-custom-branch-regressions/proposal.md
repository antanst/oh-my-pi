# Proposal

## Why

The custom branch introduces 17 verified defects in tool grouping, local updates, and archive workflows. The defects can destroy existing edits, block approval, hide tool output or failure, and show an incorrect transcript.

## What Changes

- Preserve edits on updater rejection; select only official upstream releases; build the local target; restore generated files on termination.
- Restore established tool rendering for grouped results, preserve partial and failed states, and honor native visibility.
- Preserve tool order across prose, reads, retries, streaming updates, replay, and incremental append batches.
- Make group expansion available in shared viewers and keep compact summaries within the terminal width.
- Change the default group expansion binding from Ctrl+X to Alt+X to preserve autoresearch. The action remains configurable and independent of Ctrl+O.
- Detect archive destination collisions before synchronizing main specs.

## Capabilities

### New Capabilities

- `archive-workflow`: Require destination preflight before archive workflows change main specs.

### Modified Capabilities

- `tool-transcript-grouping`: Preserve execution lifecycle, result rendering, order, visibility, and expansion across supported transcript surfaces.
- `local-update`: Preserve user edits, select upstream-only release targets, handle termination, and prevent cross-target stale installation.

## Impact

- Affects the coding-agent event/input controllers, replay helpers, TUI group and transcript components, shared viewers, keybinding docs, updater script, tests, and archive command/skill prompts.
- Uses existing rendering, keybinding, and native visibility helpers. Adds no dependencies and changes no persisted session format.
- Keeps grouping opt-in, preserves the accepted version-only updater skip rule, and excludes defects inherited from official OMP.
- Implements all numbered findings from the branch review. Starts with findings 1–3. Commits are authorized; deployment and push are out of scope.
