# tool-transcript-grouping Specification

## Purpose
Keeps long runs of tool calls compact in the transcript, while the user can still
open the details of each call in the run.

## Requirements

### Requirement: Opt-in grouping setting

The system SHALL provide the boolean setting `display.groupConsecutiveTools` with
default `false`. While the setting is `false`, tool calls SHALL render exactly as
before this change.

#### Scenario: Setting is off

- **WHEN** `display.groupConsecutiveTools` is `false`
- **THEN** each tool call renders as its own card and no group card appears

#### Scenario: Setting is on

- **WHEN** `display.groupConsecutiveTools` is `true` and a run of consecutive
  built-in tool calls occurs
- **THEN** the run renders as one group card

### Requirement: One group card per run

While `display.groupConsecutiveTools` is `true`, consecutive calls of built-in tools
SHALL render as one group card. The `read` tool SHALL keep its existing read-group
rendering and MUST NOT join this group. Tool calls from extensions MUST NOT join.

#### Scenario: Mixed built-in run

- **WHEN** two or more built-in tool calls other than `read` run in sequence
- **THEN** they share one group card

#### Scenario: Read stays separate

- **WHEN** a `read` call occurs inside a run of other built-in tool calls
- **THEN** the `read` call renders with its existing read group, and the other calls
  form their own group card

#### Scenario: Extension tool breaks the run

- **WHEN** a tool call from an extension occurs between two built-in calls
- **THEN** the two built-in calls do not share a group card

### Requirement: Run break rule

A group run SHALL end at visible assistant text, at an image, at a `read` call, or
at a tool call from an extension. A thinking block MUST NOT end a run while thinking
is collapsed. A run MAY continue across consecutive assistant completions while no
break occurs.

#### Scenario: Assistant text breaks the run

- **WHEN** the assistant writes visible text between two built-in tool calls
- **THEN** the calls render in two separate group cards

#### Scenario: Thinking does not break the run

- **WHEN** the assistant has thinking blocks between two built-in tool calls and the
  thinking blocks stay collapsed
- **THEN** both calls stay in one group card

#### Scenario: Run across completions

- **WHEN** built-in tool calls continue across consecutive assistant completions
  with no visible assistant text or image between them
- **THEN** all calls stay in one group card

### Requirement: Collapsed head text

Collapsed, the group card SHALL show the latest call summary followed by the number
of additional calls in the run. The card SHALL update in place when a new call joins
the run. A run with one call SHALL NOT show a count.

#### Scenario: Second call joins

- **WHEN** the first built-in call is shown and a second call joins the run
- **THEN** the same card shows the second call summary and a count of 1

#### Scenario: Single call

- **WHEN** a run contains one call
- **THEN** the card shows only that call summary

### Requirement: Expanded group lists each call

The group card SHALL expand and collapse through its own action,
`app.tools.toggleGroupExpansion` (default Ctrl+X), independent of tool-output
expansion (Ctrl+O). Expanded, it SHALL show one row per call in run order, with each
call summary. Collapsing SHALL restore the collapsed head text.

#### Scenario: Expand a run

- **WHEN** the user presses Ctrl+X on a transcript with a group card that holds three
  calls
- **THEN** every group card shows three rows, one per call, in order

#### Scenario: Collapse a run

- **WHEN** the user presses Ctrl+X again
- **THEN** every group card shows only the latest call summary and the count

#### Scenario: Tool output expansion is separate

- **WHEN** the user presses Ctrl+O on a transcript with a collapsed group card
- **THEN** tool-output expansion changes per-call cards, and the group card stays
  collapsed

#### Scenario: New run follows the current state

- **WHEN** grouped calls are expanded and a new group card appears
- **THEN** the new card is expanded too

### Requirement: Hidden activity takes precedence

While `display.hideToolActivity` is `true`, group cards SHALL NOT render. The global
tool-output toggle MUST NOT show them.

#### Scenario: Both settings on

- **WHEN** `display.groupConsecutiveTools` and `display.hideToolActivity` are both
  `true`
- **THEN** no group card is visible

### Requirement: Error visibility

A group card SHALL show an error marker when any call in its run failed. Grouping
MUST NOT hide a failure.

#### Scenario: Failed call in a run

- **WHEN** one call in a grouped run returns an error
- **THEN** the group card shows an error marker, and the expanded row for that call
  shows the error

### Requirement: Display-only grouping

Grouping SHALL change only the transcript display. Every tool call and tool result
SHALL stay in the session history and in the model context.

#### Scenario: Model still sees every call

- **WHEN** a run of three calls renders as one group card
- **THEN** the model receives all three calls and all three results

### Requirement: Same result in history and live

A resumed session SHALL render group cards with the same rule as live streaming.
A late result SHALL update the group card that holds its call.

#### Scenario: Resume a grouped run

- **WHEN** a session that contains a grouped run is resumed
- **THEN** the run renders as one group card with the same head text as during the
  live session

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
