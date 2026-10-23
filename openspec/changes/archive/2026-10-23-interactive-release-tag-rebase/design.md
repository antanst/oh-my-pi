# Design

## Context

Single POSIX sh script, `scripts/local-update.sh`. Runs on this workstation against `origin` (fork) and `upstream` (can1357/oh-my-pi). Release tags are plain `vX.Y.Z` (see `git tag -l 'v[0-9]*'`); no pre-release suffixes observed.

## Goals / Non-Goals

**Goals:**
- Stateless "is there something new" detection; no marker files.
- Prompt only when a newer release tag exists.

**Non-Goals:**
- Keeping local `main` in sync (no longer needed; drop the fast-forward).
- Pre-release channels, downgrade handling, cherry-picking specific tags.

## Decisions

- **Newer detection**: `git merge-base --is-ancestor "$TAG" custom` — exit 0 means `custom` already contains the tag. Alternatives considered: storing the last-rebased tag in a state file (extra state, can drift from reality) or comparing to `main` (main no longer relevant). Rejected both.
- **Tag selection**: `git tag -l --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1`. Git's version sort handles multi-digit components; the regex excludes pre-release suffixes (`v1.2.3-rc1`) and non-release tags.
- **Tag fetch**: extend the existing upstream fetch to `git fetch --tags upstream`.
- **Flag parsing**: loop over `"$@"`; `--non-interactive` sets a flag, anything else dies with usage. Keeps `set -u` safe.
- **Prompt**: `printf` + `read -r`; `ANSWER` pre-initialized to `""` so `set -u` and EOF-on-piped-stdin both fall through to the default (yes).
- **Order**: checkout `custom` before the prompt — the later build must compile the `custom` working tree even if the user declines.
- **Decline path**: skip rebase, continue to build/install. Rebuilding without updating is a legitimate outcome (local commits, native addon refresh).

## Risks / Trade-offs

- [Rebase onto tag conflicts] → existing abort path already restores the start branch and leaves `custom` untouched.
- [Empty tag list] → warn and continue; build still valid for the current tree.
- [Prompt invisible when stdin is not a terminal] → EOF reads as empty → default yes, same as accepted prompt; documented in the script header.

## Migration Plan

None. Local script; next run uses the new flow.

## Open Questions

None.
