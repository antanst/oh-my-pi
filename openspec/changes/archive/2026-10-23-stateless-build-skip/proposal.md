# Proposal

## Why

Three problems surfaced in real use: the `.scratch` marker keeps state outside git-tracked reality, the dirty-tree check dies on ordinary untracked files (in-progress OpenSpec change dirs), and every build leaves `packages/stats/src/embedded-client.generated.txt` populated, which would trip the very next run's dirty check.

## What Changes

- Replace the `.scratch` marker with a stateless check: skip install/build/install when the installed `~/.local/bin/omp --version` equals the version in the tree's `packages/coding-agent/package.json`, no rebase happened, and the native addon is present. Drop the `.scratch` gitignore rule.
- Dirty-tree check considers only tracked modifications (`git status --porcelain --untracked-files=no`); untracked files no longer block the update.
- Restore `packages/stats/src/embedded-client.generated.txt` to its checked-in empty state on every exit, including failed builds (the binary build populates it and nothing resets it).

## Capabilities

### New Capabilities

### Modified Capabilities

- `local-update`: remove the marker-based skip requirement, add the version-based skip, untracked-file tolerance, and bundle-reset requirements.

## Impact

- `scripts-local/local-update.sh` and one `.gitignore` line. Granularity limit: local source commits that do not bump the package version are not rebuilt — accepted by the user.
