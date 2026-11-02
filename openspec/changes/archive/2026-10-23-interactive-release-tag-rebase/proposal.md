# Proposal

## Why

`scripts-local/local-update.sh` rebases the `custom` branch onto `main` on every run. Updates should come from release tags instead, and the user wants a choice before moving to a newer release.

## What Changes

- Fetch tags from `upstream` and pick the newest release tag matching `v<digits>.<digits>.<digits>`.
- Rebase `custom` onto the newest release tag instead of `main`. **BREAKING**: the rebase target is no longer a branch.
- Interactive by default: when the newest release tag is not already an ancestor of `custom`, prompt `[Y/n]` before rebasing. Empty answer = yes. Decline = skip the rebase, continue with build and install.
- New `--non-interactive` flag: no prompt; rebase automatically when a newer release tag exists.
- Remove the `git fetch upstream main:main` fast-forward of local `main`; `main` is no longer the rebase base. This also removes the failure when the script is started while `main` is checked out.
- Keep everything else: dirty-tree check, `custom` checkout, clean conflict abort, native addon copy, build, install, stock backup, `--version` check.

## Capabilities

### New Capabilities

- `local-update`: behavior of the local updater script — tag selection, rebase target rules, prompting, and non-interactive mode.

### Modified Capabilities

## Impact

- `scripts-local/local-update.sh` only. No product code, no dependencies.
