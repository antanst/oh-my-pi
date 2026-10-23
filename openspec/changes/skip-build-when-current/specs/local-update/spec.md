# Spec Delta

## ADDED Requirements

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
