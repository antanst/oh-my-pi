## MODIFIED Requirements

### Requirement: Rebase target is the newest release tag

The script SHALL select the newest exact `v<digits>.<digits>.<digits>` tag advertised by `upstream` and rebase `custom` onto that upstream tag's commit. Local-only tags, origin tags, stale tags, and conflicting local tag objects MUST NOT change the target. The script MUST NOT rebase onto a branch.

#### Scenario: Newest release tag selected

- **WHEN** upstream has release tags and custom lacks the newest tag
- **THEN** the script rebases onto that upstream tag's commit

#### Scenario: No release tags found

- **WHEN** upstream advertises no matching release tag
- **THEN** the script warns, skips rebase, and continues with build and install

#### Scenario: Local tags differ from upstream

- **WHEN** local or origin tags have higher versions or conflicting objects
- **THEN** the script still uses the newest matching upstream release and its upstream commit

### Requirement: Embedded stats bundle reset after every run

The script SHALL reject tracked modifications without changing them. After accepting a clean tree, it SHALL restore the generated stats bundle on success, failure, or handled HUP, INT, and TERM termination. Cleanup MUST NOT discard edits that existed before the script started.

#### Scenario: Build populates the bundle

- **WHEN** a build changes the embedded stats bundle
- **THEN** the script restores the checked-in bundle before exit

#### Scenario: Interrupted build leaves no dirt

- **WHEN** a build fails or receives HUP, INT, or TERM after changing the bundle
- **THEN** the script restores the bundle and exits unsuccessfully

#### Scenario: Existing edits are preserved

- **WHEN** the bundle contains a tracked user edit before the update
- **THEN** the script refuses to run and preserves the edit exactly

## ADDED Requirements

### Requirement: Local installation uses a local build

The updater SHALL build and install the current local binary regardless of an inherited `CROSS_TARGET`. It MUST NOT install a stale `dist/omp` when a cross-target build produces another filename.

#### Scenario: Inherited cross target

- **WHEN** `CROSS_TARGET` names another target and an old `dist/omp` exists
- **THEN** the updater produces and installs the new local binary, not the old file
