# Proposal

## Why

The script rebuilds and reinstalls on every run even when nothing changed since the last build. A no-op run currently costs a full `bun install` plus binary build.

## What Changes

- Record the HEAD commit of every successful install in `.scratch/local-update-built-sha` (inside the repository, gitignored, created on demand).
- Skip dependency install, build, and install when no rebase happened, the native addon is present, and HEAD equals the recorded commit; print a "nothing to do" message and exit 0.
- Declining a tag also becomes a full no-op when the tree is unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities

- `local-update`: new requirement — build skipped when the tree is unchanged since the last install.

## Impact

- `scripts/local-update.sh` only.
