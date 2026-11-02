## MODIFIED Requirements

### Requirement: Run break rule

A group run SHALL end at visible assistant text, an image, a `read` call, or an extension tool call. Boundaries SHALL follow content order and apply once during cumulative streaming updates. Collapsed thinking MUST NOT end a run. A run MAY span assistant completions and append batches without a visible boundary. Any intervening non-read call SHALL end the current read group.

#### Scenario: Assistant text breaks the run

- **WHEN** the assistant writes visible text between two built-in calls, including within one message
- **THEN** the calls render in separate group cards on opposite sides of that text

#### Scenario: Thinking does not break the run

- **WHEN** collapsed thinking occurs between built-in calls
- **THEN** both calls stay in one group card

#### Scenario: Run across completions

- **WHEN** calls continue across assistant completions without a visible boundary
- **THEN** the calls stay in one group card

#### Scenario: Cumulative text is not a new boundary

- **WHEN** streamed updates repeat leading text and add consecutive calls after that text
- **THEN** the calls after the text share one group

#### Scenario: Intervening tool ends the read group

- **WHEN** a read, a grouped bash call, and another read occur in order
- **THEN** the transcript shows two separate read groups around the bash group

#### Scenario: Append batches preserve runs

- **WHEN** consecutive calls arrive in separate builder append batches or outline entries
- **THEN** the transcript uses the same grouping as one complete rebuild and outline targets still select the correct messages

#### Scenario: A shared group precedes prose in the same entry

- **WHEN** an assistant entry adds a call to an existing group and then writes visible prose
- **THEN** the prose remains a separate selectable target and copying either target preserves its full content without duplication

### Requirement: Expanded group lists each call

The configurable action `app.tools.toggleGroupExpansion` (default Alt+X) SHALL expand and collapse group rows in the main transcript and shared transcript viewers. It SHALL stay independent of tool-output expansion (Ctrl+O). Expanded groups SHALL list calls in order. New groups SHALL inherit the current row state. The main input handler SHALL NOT consume this action when grouping is disabled.

#### Scenario: Expand a run

- **WHEN** the user invokes the group action on a three-call group
- **THEN** the group shows three call summaries in order

#### Scenario: Collapse a run

- **WHEN** the user invokes the group action again
- **THEN** the group shows the latest summary and the extra-call count

#### Scenario: Tool output expansion is separate

- **WHEN** the user presses Ctrl+O on a collapsed group
- **THEN** output visibility changes without expanding group rows

#### Scenario: New run follows the current state

- **WHEN** a new group appears while group rows are expanded
- **THEN** the new group is expanded

#### Scenario: Shared viewer controls

- **WHEN** the user invokes a configured group action in the agent, copy, or rewind viewer
- **THEN** group rows toggle without changing the output toggle

#### Scenario: Autoresearch keeps its shortcut

- **WHEN** autoresearch registers Ctrl+X and the default keybindings apply
- **THEN** Ctrl+X reaches autoresearch with grouping enabled or disabled

### Requirement: Hidden activity takes precedence

While `display.hideToolActivity` is true, group cards SHALL be hidden in both terminal rendering and native descriptions. Output expansion MUST NOT expose them. Hidden groups SHALL retain their content for a later visibility change.

#### Scenario: Both settings on

- **WHEN** grouping and hidden activity are both enabled
- **THEN** neither terminal rows nor native surfaces show the group

#### Scenario: Activity becomes visible

- **WHEN** hidden activity is disabled after results arrive
- **THEN** the retained group can show its results

### Requirement: Grouped results follow tool-output expansion

When tool-output expansion is enabled, a group SHALL use the established custom or built-in result renderer after each visible call summary, with its normal context, staging, fallback, and partial state. Without expansion it SHALL show summaries only. The group MUST NOT reformat or truncate renderer output. Row expansion (Alt+X) and output expansion (Ctrl+O) SHALL stay independent.

#### Scenario: Collapsed card with expansion on

- **WHEN** output expansion is enabled and group rows are collapsed
- **THEN** the latest summary is followed by that call's rendered result

#### Scenario: Row-expanded card with expansion on

- **WHEN** output expansion and group rows are expanded
- **THEN** each call summary is followed by its rendered result

#### Scenario: Expansion off keeps compact form

- **WHEN** output expansion is disabled
- **THEN** no result lines appear

#### Scenario: Renderer staging is preserved

- **WHEN** a renderer produces a staged result
- **THEN** the group shows that result unchanged

#### Scenario: Single-call run with expansion on

- **WHEN** a group contains one call and output expansion is enabled
- **THEN** its summary and rendered result appear

#### Scenario: Late result renders

- **WHEN** a result arrives after its run ends
- **THEN** the group updates that call's result

#### Scenario: Output toggle keeps row structure

- **WHEN** Ctrl+O toggles output on a row-expanded group
- **THEN** rows remain in call order

#### Scenario: Built-in registry renderer

- **WHEN** a built-in tool has no renderer methods on its live instance
- **THEN** grouped output still uses its registered renderer and displays the result

#### Scenario: Native results have no body

- **WHEN** a native renderer stores a result count, timeout, error, or outcome in its result header without body content
- **THEN** grouped output preserves that information, status, and controls while omitting duplicated command or code input

## ADDED Requirements

### Requirement: Grouped approval previews complete

A grouped call SHALL complete the same approval-preview readiness handshake as an ordinary call. Grouping MUST NOT block the approval dialog.

#### Scenario: Execution starts without a streamed card

- **WHEN** a grouped call starts with an approval waiter and no earlier preview
- **THEN** the preview waiter resolves and approval can proceed

### Requirement: Partial results remain mutable

A partial result SHALL leave its grouped call pending. A finished run containing a pending call MUST NOT retire into immutable scrollback before its final result.

#### Scenario: Final failure follows progress

- **WHEN** a call emits progress, the run ends, and the final result fails under viewport pressure
- **THEN** the final failure remains visible rather than being lost in retired scrollback

### Requirement: Background failures remain failures

A grouped background job SHALL show its settled failure state regardless of whether settlement arrives before or after the launch result.

#### Scenario: Settlement and launch arrive in either order

- **WHEN** a grouped background job fails
- **THEN** its group and expanded row show failure for either event order

### Requirement: Cancellation affects one grouped call

Cancelling a grouped background call SHALL settle only that call. Other pending calls and later calls in the same group MUST remain live.

#### Scenario: One background call is cancelled

- **WHEN** one of two grouped background calls is cancelled, before or after its launch result
- **THEN** only that call stops, while its sibling and later calls retain their running state and accept updates

### Requirement: Retries replace obsolete attempts

When a retried call reuses an identifier, the transcript SHALL remove its obsolete grouped entry without removing unrelated sibling calls.

#### Scenario: Failed call succeeds on retry

- **WHEN** a failed grouped call retries with the same identifier and succeeds
- **THEN** only the current attempt remains and successful siblings remain visible

### Requirement: Summaries occupy one row

Each collapsed head and expanded call summary SHALL fit one terminal row at the available width. Truncation SHALL preserve the extra-call count and failure marker when space permits. This limit MUST NOT truncate result content.

#### Scenario: Long command at a narrow width

- **WHEN** a group contains a long command and the terminal is narrow
- **THEN** its summary occupies one row with the count and failure marker visible
