# Design

## Context

The archived marker approach (`.scratch/local-update-built-sha`) worked but kept state the user rejected. The installed binary already reports `omp/<version>`; the tree's version lives in `packages/coding-agent/package.json` (`"version": "18.12.6"` is the first `"version"` line, before any dependency blocks).

## Goals / Non-Goals

**Goals:**
- No state outside git-tracked reality; the binary itself is the record.
- Runs must survive ordinary untracked files and must not leave generated dirt behind.

**Non-Goals:**
- Commit-granular build tracking (would need embedded build metadata that the binary does not carry).

## Decisions

- **Version comparison**: installed `omp --version` output vs `omp/<tree version>` extracted from `packages/coding-agent/package.json` with `grep -m1 '"version"'` + sed. A missing or failing binary yields an empty string, which never matches, so the first run always builds.
- **Granularity shortcut**: local source commits that do not bump the package version are not rebuilt. Accepted explicitly by the user; documented as a shortcut comment in the script and in the spec scenario.
- **Untracked tolerance**: `git status --porcelain --untracked-files=no`. Tracked modifications still block; untracked OpenSpec change dirs and scratch files do not. Risk accepted: untracked source files would be compiled without invalidating anything — the user's untracked files are documentation.
- **Bundle reset via EXIT trap**: `trap 'git checkout -- packages/stats/src/embedded-client.generated.txt 2>/dev/null' EXIT` set right after entering the repo root. Equivalent to `gen:stats:reset` (checked-in state is the empty blob), runs on success, failure, skip, and interrupt paths, and is a no-op when unmodified. A `git checkout --` after an interrupted build was rejected because it would not cover `die` exits.

## Risks / Trade-offs

- [Same-version local commits are never rebuilt] → user-accepted; bump the version or rebuild manually to force one.
- [Package.json layout change could break the version extraction] → top-level `"version"` has been the third line historically; a failure yields a mismatch, which only causes a rebuild, never a wrong skip.

## Migration Plan

None. The `.scratch` directory was never created on this machine; the gitignore rule is dropped in the same change.

## Open Questions

None.
