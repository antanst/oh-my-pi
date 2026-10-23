# Tasks

## 1. Script changes

- [x] 1.1 Add `--non-interactive` flag parsing (unknown arg dies with usage). Verify: `sh -n scripts/local-update.sh` passes and a run with a bogus arg exits with the usage message.
- [x] 1.2 Fetch upstream tags (`git fetch --tags upstream`), select newest `vX.Y.Z` via version sort + regex, drop the `main` fast-forward. Verify: script run lists the picked tag; `git tag -l` cross-check.
- [x] 1.3 Add newer-tag detection (`git merge-base --is-ancestor`), interactive `[Y/n]` prompt with empty=yes, auto-rebase under `--non-interactive`, decline/no-tag/no-newer paths that skip the rebase and continue. Verify: table-test below covers each path.

## 2. Verification

- [x] 2.1 Exercise all paths in a scratch clone (non-interactive auto-rebase, interactive accept, decline, already-current, no tags) using a fake `bun`/build stub so no real build runs. Verify: observed rebase/skip behavior matches the spec scenarios.
