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

### Requirement: Build skipped when tree is unchanged

The script SHALL record the HEAD commit after each successful install. When a run performs no rebase, the native addon is present in the repository, and HEAD equals the recorded commit, the script SHALL skip dependency install, build, and install, print a "nothing to do" message, and exit successfully.

#### Scenario: Second run without changes

- **WHEN** the script runs twice with no upstream or local changes in between
- **THEN** the second run performs no build and exits 0

#### Scenario: Accepted rebase builds

- **WHEN** a newer release tag is accepted and rebased onto
- **THEN** the script builds, because HEAD no longer matches the recorded commit

#### Scenario: Declined tag is a no-op

- **WHEN** the user declines a newer release tag and nothing else changed
- **THEN** the script skips the build

#### Scenario: Missing native addon forces build

- **WHEN** the native addon is absent from the repository
- **THEN** the script does not skip the build, even if the recorded commit matches
