# Tasks

## 1. Script changes

- [x] 1.1 Add `--force` parsing, bypass the version-match skip when set, and print an override notice; update the usage line. Verify: `sh -n`, `shellcheck --shell=sh`, table-test force scenario.

## 2. Verification

- [x] 2.1 Extend the scratch-clone table-test: with matching version and native addon, plain rerun skips while `--force` rebuilds and reinstalls. Verify: all scenarios pass.
