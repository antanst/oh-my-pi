# Design

## Context

The updater already knows when it changed nothing: the rebase block ends with `REBASE=0`, and the native-addon glob reports whether the addon is present. Only the "already built" half is missing.

## Goals / Non-Goals

**Goals:**
- Zero-cost no-op runs; skip `bun install`, build, and install together.

**Non-Goals:**
- Content-addressed build caching, per-file change detection.

## Decisions

- **Key on the commit, not the tag**: `custom` carries local commits on top of a tag, so "same version" is not enough. `git rev-parse HEAD` is the exact tree state (the dirty-tree check guarantees the working tree matches it).
- **Marker file** `.scratch/local-update-built-sha`, inside the repository and gitignored, created on demand. It ties the marker to the checkout itself: every clone carries its own state, and deleting the checkout clears it. An out-of-project location (`~/.omp/…`) was rejected per user preference — no state outside the repo. Written only after the installed binary passes the `--version` check. A failed build leaves the old marker, so the next run rebuilds. A deleted `.scratch/` merely triggers one rebuild.
- **Skip check order**: after the native-addon glob, before the copy. The conditions are mutually exclusive with the copy path (`NATIVE_FOUND=1` vs empty), so an appearing addon can never be skipped over.
- **Declined tags** fall out for free: no rebase, unchanged HEAD, marker matches, full no-op.

## Risks / Trade-offs

- [A manual rebuild outside the script is not recorded] → the marker can go stale. Harmless while that binary stays installed; noted as a shortcut comment in the script.
- [User deletes `node_modules`] → skip path never reinstalls. The binary is static, so this cannot corrupt the install; next real change rebuilds.

## Migration Plan

None. First run after the change records the marker and builds once.

## Open Questions

None.
