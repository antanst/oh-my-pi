# Design

## Context

Single flag on an existing decision point: the skip check at `scripts-local/local-update.sh`.

## Decisions

- `--force` only clears the skip decision; the dirty-tree check and native-addon copy are unaffected — a forced build still requires a clean tracked tree and still embeds the copied addon.
- Unknown flags keep dying with usage; the usage line now lists both flags.
- A forced run prints one line when it overrides a would-be skip, so the log explains why a build happened despite matching versions.

## Risks / Trade-offs

None beyond the documented same-version granularity shortcut that `--force` exists to escape.

## Migration Plan

None.

## Open Questions

None.
