# Proposal

## Why

The version-based skip makes it impossible to rebuild when the installed binary already matches the tree version — needed after content changes that do not bump the version, or to refresh a suspected-bad build.

## What Changes

- New `--force` flag: bypasses the version-match skip and rebuilds unconditionally.
- Force does not bypass the dirty-tree check or the native-addon copy step.

## Capabilities

### New Capabilities

### Modified Capabilities

- `local-update`: the skip requirement gains the force exception.

## Impact

- `scripts/local-update.sh` only.
