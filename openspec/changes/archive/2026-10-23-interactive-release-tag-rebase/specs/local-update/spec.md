# Spec Delta

## Purpose

Defines how the local updater script picks its rebase target, prompts the user, and behaves in non-interactive mode.

## ADDED Requirements

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
