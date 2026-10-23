# Tasks

## 1. Script changes

- [x] 1.1 Replace the `.scratch` marker with the version comparison skip (installed `omp --version` vs tree package.json version), drop the marker write and the `.scratch` gitignore rule. Verify: `sh -n`, `shellcheck --shell=sh`, table-test skip scenarios.
- [x] 1.2 Make the dirty-tree check ignore untracked files (`--untracked-files=no`) and add an EXIT trap restoring `packages/stats/src/embedded-client.generated.txt`. Verify: table-test untracked and bundle-reset scenarios.

## 2. Verification

- [x] 2.1 Extend the scratch-clone table-test: unchanged rerun skips, version bump rebuilds, same-version local commits skip (documented shortcut), untracked dir tolerated, tracked modification still blocks, build leaves the embedded bundle clean, missing native addon forces build. Verify: all scenarios pass.
