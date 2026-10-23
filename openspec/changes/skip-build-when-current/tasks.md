# Tasks

## 1. Script changes

- [x] 1.1 Record HEAD to `.scratch/local-update-built-sha` (gitignored, created on demand) after a successful install, and skip install/build with a "nothing to do" exit-0 path when no rebase happened, the native addon is present, and HEAD matches the marker. Verify: scratch table-test build counter.

## 2. Verification

- [x] 2.1 Extend the scratch-clone table-test with a build counter: unchanged rerun skips, accepted rebase rebuilds, declined tag is a full no-op, missing native addon forces a build. Verify: all scenarios pass.
