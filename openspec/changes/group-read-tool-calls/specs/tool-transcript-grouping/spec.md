# Spec Delta

## MODIFIED Requirements

### Requirement: One group card per run

While `display.groupConsecutiveTools` is `true`, consecutive calls of built-in tools SHALL render as one group card, including `read` calls. Tool calls from extensions MUST NOT join. When the setting is `false`, existing read rendering SHALL remain unchanged.

#### Scenario: Mixed built-in run
- **WHEN** built-in calls include `read`, `find`, `grep`, `lsp`, and `wait` with no run break between them
- **THEN** the calls share one group card in call order

#### Scenario: Internal URL read joins the run
- **WHEN** a built-in `read` of a `skill://` URL occurs between other built-in calls without a run break
- **THEN** the read joins the same group card

#### Scenario: Grouping is disabled
- **WHEN** `display.groupConsecutiveTools` is `false`
- **THEN** read calls retain their existing compact or standalone rendering

#### Scenario: Read stays separate
- **WHEN** `display.groupConsecutiveTools` is `false` and a read occurs between other tool calls
- **THEN** the read retains its existing separate rendering

#### Scenario: Extension tool breaks the run
- **WHEN** a tool call from an extension occurs between two built-in calls
- **THEN** the two built-in calls do not share a group card

### Requirement: Run break rule

A group run SHALL end at visible assistant text, at an image, or at a tool call from an extension. A `read` call MUST NOT end an otherwise eligible run. A thinking block MUST NOT end a run while thinking is collapsed. A run MAY continue across consecutive assistant completions while no break occurs.

#### Scenario: Assistant text breaks the run
- **WHEN** the assistant writes visible text between two built-in tool calls
- **THEN** the calls render in two separate group cards

#### Scenario: Read does not break the run
- **WHEN** a built-in read occurs between two other built-in calls without a visible separator
- **THEN** all three calls stay in one group card

#### Scenario: Thinking does not break the run
- **WHEN** the assistant has thinking blocks between two built-in tool calls and the thinking blocks stay collapsed
- **THEN** both calls stay in one group card

#### Scenario: Run across completions
- **WHEN** built-in tool calls continue across consecutive assistant completions with no visible assistant text or image between them
- **THEN** all calls stay in one group card

### Requirement: Grouped results follow tool-output expansion

While tool-output expansion is enabled, a group card SHALL render each visible call's result through that tool's result renderer, directly after the call's summary line. While tool-output expansion is disabled, the card SHALL show summaries only, except that read previews SHALL follow the existing read preview setting. The renderer's own staging SHALL decide the result form; the group card MUST NOT reformat or truncate what the renderer produces. Row expansion and tool-output expansion SHALL stay independent toggles.

#### Scenario: Collapsed card with expansion on
- **WHEN** tool-output expansion is enabled and a group card is collapsed
- **THEN** the card shows the latest call summary followed by that call's rendered result

#### Scenario: Row-expanded card with expansion on
- **WHEN** tool-output expansion is enabled and a group card is row-expanded
- **THEN** each call row is followed by that call's rendered result

#### Scenario: Expansion off keeps compact form
- **WHEN** tool-output expansion and read previews are disabled
- **THEN** the group card shows only call summaries and the extra-call count, with no result lines

#### Scenario: Renderer staging is preserved
- **WHEN** a tool's result renderer produces a staged form of a result
- **THEN** the group card shows that staged form unchanged

#### Scenario: Single-call run with expansion on
- **WHEN** a run holds one call and tool-output expansion is enabled
- **THEN** the collapsed card shows the call summary and its rendered result

#### Scenario: Late result renders
- **WHEN** a call's result arrives after the run is sealed
- **THEN** the group card updates that call's rendered result in place

#### Scenario: Output toggle keeps row structure
- **WHEN** the user toggles tool-output expansion on a row-expanded group card
- **THEN** the rows stay listed in run order and results follow the output and read preview settings

#### Scenario: Read preview with output expansion off
- **WHEN** read previews are enabled and a visible grouped read has a result
- **THEN** the group card shows the read preview even if tool-output expansion is disabled

## ADDED Requirements

### Requirement: Grouped reads retain their results

A grouped read SHALL retain its result, error, preview settings, and image presentation. The group SHALL show an error marker if any grouped read fails. Read results SHALL remain available through the existing independent group-row and tool-output expansion controls.

#### Scenario: Grouped read fails
- **WHEN** a read within a mixed group fails
- **THEN** the group shows an error marker and the failed call's error is available when expanded

#### Scenario: Grouped read returns an image
- **WHEN** a grouped read returns an image
- **THEN** the image remains available in the transcript as it is for an ungrouped read

#### Scenario: Read result arrives late
- **WHEN** a read result arrives after its group is closed to new calls
- **THEN** the result updates the read in its original group without removing sibling calls

#### Scenario: Rebuilt mixed group
- **WHEN** a session with mixed read and other built-in calls is resumed or rebuilt
- **THEN** its group boundaries, call order, and available results match the live transcript
