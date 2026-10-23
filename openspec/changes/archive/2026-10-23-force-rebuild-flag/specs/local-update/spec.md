# Spec Delta

## MODIFIED Requirements

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
