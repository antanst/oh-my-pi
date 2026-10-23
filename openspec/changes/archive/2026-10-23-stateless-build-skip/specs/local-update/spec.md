# Spec Delta

## ADDED Requirements

### Requirement: Build skipped when installed binary is current

The script SHALL compare the version reported by `~/.local/bin/omp --version` with the version in the tree's `packages/coding-agent/package.json` and skip dependency install, build, and install when no rebase happened, the native addon is present in the repository, and both versions match. A skip prints a "nothing to do" message and exits successfully.

#### Scenario: Unchanged rerun

- **WHEN** the script runs again with no rebase, the native addon present, and matching versions
- **THEN** no build runs and the script exits 0

#### Scenario: Version bump rebuilds

- **WHEN** a rebase brings a new package version
- **THEN** the script builds, because the installed version no longer matches the tree

#### Scenario: Local commits with the same version are not rebuilt

- **WHEN** the tree contains local source commits that do not change the package version
- **THEN** the script skips the build; this granularity limit is accepted

#### Scenario: Missing native addon forces build

- **WHEN** the native addon is absent from the repository
- **THEN** the script does not skip the build, even if the versions match

### Requirement: Untracked files do not block the update

The dirty-tree check SHALL consider only tracked modifications. Untracked files and directories MUST NOT cause the script to refuse to run.

#### Scenario: In-progress OpenSpec change directory

- **WHEN** an untracked directory exists under `openspec/changes/` and no tracked file is modified
- **THEN** the script proceeds with its normal flow

#### Scenario: Tracked modification still blocks

- **WHEN** a tracked file is modified
- **THEN** the script refuses to run with the dirty-tree message

### Requirement: Embedded stats bundle reset after every run

The script SHALL restore `packages/stats/src/embedded-client.generated.txt` to its checked-in state on every exit, whether the build succeeded, failed, or was skipped.

#### Scenario: Build populates the bundle

- **WHEN** a build run populates the embedded stats bundle file
- **THEN** the working tree is clean and the file is empty when the script exits

#### Scenario: Interrupted build leaves no dirt

- **WHEN** the build fails after the bundle file was populated
- **THEN** the file is restored before the script exits
