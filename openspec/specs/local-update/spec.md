# local-update Specification

## Purpose
Defines how the local updater script picks its rebase target, prompts the user, and behaves in non-interactive mode.

## Requirements

### Requirement: Rebase target is the newest release tag

The script SHALL fetch tags from `upstream`, select the newest tag whose name matches `v<digits>.<digits>.<digits>` exactly, and use that tag as the only rebase target for `custom`. The script MUST NOT rebase onto any branch, including `main` or `master`.

#### Scenario: Newest release tag selected

- **WHEN** the upstream repository contains release tags and `custom` lacks the newest one
- **THEN** the script rebases `custom` onto that tag

#### Scenario: No release tags found

- **WHEN** no tag matches the release pattern after fetching
- **THEN** the script warns, skips the rebase, and continues with build and install

### Requirement: Interactive prompt on newer release tag

Without `--non-interactive`, when the newest release tag is not already an ancestor of `custom`, the script SHALL ask whether to rebase onto it. An empty answer counts as yes; an explicit refusal skips the rebase and continues with build and install.

#### Scenario: User accepts

- **WHEN** the user answers yes (or presses Enter)
- **THEN** the script rebases `custom` onto the newest release tag

#### Scenario: User declines

- **WHEN** the user answers no
- **THEN** the script skips the rebase and continues with build and install

### Requirement: Non-interactive mode

With `--non-interactive`, the script SHALL NOT prompt and SHALL rebase onto the newest release tag whenever that tag is not already an ancestor of `custom`.

#### Scenario: Newer tag exists

- **WHEN** the script runs with `--non-interactive` and a newer release tag exists
- **THEN** the script rebases without asking

### Requirement: No rebase when already current

When the newest release tag is already an ancestor of `custom`, the script SHALL NOT prompt and SHALL NOT rebase, regardless of mode.

#### Scenario: Tag already contained

- **WHEN** the newest release tag is an ancestor of `custom`
- **THEN** the script proceeds directly to build and install

### Requirement: Build skipped when installed binary is current

The script SHALL compare the version reported by `~/.local/bin/omp --version` with the version in the tree's `packages/coding-agent/package.json` and skip dependency install, build, and install when no rebase happened, the native addon is present in the repository, and both versions match, unless `--force` is given. A skip prints a "nothing to do" message and exits successfully. With `--force`, the script SHALL rebuild even when all skip conditions hold.

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

#### Scenario: Force flag rebuilds

- **WHEN** the script runs with `--force` while all skip conditions hold
- **THEN** the script rebuilds and reinstalls

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
