# Design

## Context

The transcript has two render paths that must agree: `ChatTranscriptBuilder`
(history and resume) and `EventController` (live). Both already build a
`ReadToolGroupComponent` for uninterrupted runs of `read` calls. The host toggles
expansion by walking chat children and calling `setExpanded` (Ctrl+O), so any new
group component must implement the same handle.

Tool cards come from `ToolExecutionComponent`. A tool can supply its own
`renderCall`/`renderResult` (built-in renderer or extension), and the global
`display.hideToolActivity` preference hides cards at render time.

See proposal.md for motivation and the specs for required behavior.

## Goals / Non-Goals

Goals:

- One group card per uninterrupted run of built-in calls, updated in place.
- Collapsed head uses the latest call summary plus a count.
- Expanded head lists one row per call.
- History and live paths produce the same card.
- Opt-in setting, off by default.

Non-Goals:

- No retroactive regrouping of cards already on screen when the setting changes.
- No per-tool configuration and no grouping for `read` or extension tools.
- No call result bodies inside the group card.
- No session storage or model context changes.

## Decisions

- **New component over generalizing the read group.** `ReadToolGroupComponent` is
  read-specific (paths, selectors, previews, conflicts, usage rows) and large. Add
  `ToolCallGroupComponent` in `packages/tui/src/chat/tool-call-group.ts` and reuse
  only the handle shape: `setExpanded`, `setToolActivityVisible`, `finalize`,
  `seal`, `getTranscriptBlockVersion`.
- **Shared membership predicate.** One helper decides whether a call joins the run:
  the tool is built-in and is not `read`. Both render paths call it, so live and
  history cannot drift.
- **Shared break rule.** A run breaks on assistant text or an image, a `read` call, an
  extension tool call, or a user message. Thinking does not break a run: it is
  collapsed by default, so it must not split a visible run. Runs may span consecutive
  assistant completions, mirroring the read-group rule.
- **Head summary from the registered call renderer.** The group asks the tool for its
  custom `renderCall` (extension formats such as `$ <command>`), flattens it to one
  line, and truncates to width. Without a custom renderer it uses a short built-in
  summary, for example `$ <command>` or `Edit <path>`. A trailing `+N` shows the
  number of additional calls.
- **Group lifecycle mirrors the read group.** The builder/controller owns the active
  group, updates it by `toolCallId`, finalizes on a break, and seals at turn end. A
  late result updates its entry by id and bumps the block version.
- **Group expansion has its own key and state.** `app.tools.toggleGroupExpansion`
  (default Ctrl+X) flips `toolGroupExpanded` on the UI context and applies it to every
  group card; new cards read the same state. `setExpanded` stays a no-op so the
  Ctrl+O tool-output walk never changes group rows.
- **Setting plumbing.** Register `display.groupConsecutiveTools` in
  `packages/coding-agent/src/modes/settings.ts`, add it to
  `ChatTranscriptDisplayPreferences`, and include it in the display-preferences
  effect. Both render paths read the preference.
- **Visibility.** When `hideToolActivity` is on, the group renders `[]`, like other
  tool cards.

## Risks / Trade-offs

- [History and live logic diverge] → one predicate helper, one break helper, and
  tests that cover both paths.
- [Mid-session toggle leaves old cards ungrouped] → the setting applies to calls
  rendered after the toggle; a resume rebuilds the transcript with the new value.
  Note this in the setting description.
- [Extension result renderers do not run for grouped calls] → the group uses the
  extension call renderer for the head; per-call result previews are out of scope.
  Note this in the release notes.
- [A read call splits a long run] → intended; the read group already seals at that
  boundary.
- [Failures hidden by compact rows] → head error marker plus an error row when
  expanded.
- [Render churn on every result] → rebuild only the head and bump the block version;
  reuse the existing memo/version pattern.

## Migration Plan

No data migration. The setting defaults to `false`. To roll back, set it to `false`;
no session rewrite is needed.

## Open Questions

None.
