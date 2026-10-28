# Spec Delta

## ADDED Requirements

### Requirement: Grouped results follow tool-output expansion
While tool-output expansion is enabled, a group card SHALL render each call's result
through that tool's result renderer, directly after the call's summary line. While
tool-output expansion is disabled, the card SHALL render summaries only. The
renderer's own staging SHALL decide the result form; the group card MUST NOT
reformat or truncate what the renderer produces. Row expansion (Ctrl+X) and tool
output expansion (Ctrl+O) SHALL stay independent toggles.

#### Scenario: Collapsed card with expansion on

- **WHEN** tool-output expansion is enabled and a group card is collapsed
- **THEN** the card shows the latest call summary followed by that call's rendered
  result

#### Scenario: Row-expanded card with expansion on

- **WHEN** tool-output expansion is enabled and a group card is row-expanded
- **THEN** each call row is followed by that call's rendered result

#### Scenario: Expansion off keeps compact form

- **WHEN** tool-output expansion is disabled
- **THEN** the group card shows only call summaries and the extra-call count, with no
  result lines

#### Scenario: Renderer staging is preserved

- **WHEN** a tool's result renderer produces a staged form of a result, for example
  only the last lines of the output
- **THEN** the group card shows that staged form unchanged

#### Scenario: Single-call run with expansion on

- **WHEN** a run holds one call and tool-output expansion is enabled
- **THEN** the collapsed card shows the call summary and its rendered result

#### Scenario: Late result renders

- **WHEN** a call's result arrives after the run is sealed
- **THEN** the group card updates that call's rendered result in place

#### Scenario: Output toggle keeps row structure

- **WHEN** the user presses Ctrl+O on a transcript with a row-expanded group card
- **THEN** the rows stay listed in run order and the card's rendered results appear
  or disappear according to the new tool-output state
