# Design

## Context

See `proposal.md`. `ReadToolGroupComponent` handles compact reads separately from `ToolCallGroupComponent`; each ends the other's run. Some internal URL reads use a full tool card instead. Live events, main-session rebuilds, and `ChatTranscriptBuilder` each manage grouping boundaries.

## Goals / Non-Goals

**Goals:**
- Keep mixed built-in calls in one ordered group without losing read-specific result behavior.
- Keep live and rebuilt transcripts consistent, including late results and retries.

**Non-Goals:**
- Change tool execution, persisted history, or model context.
- Group extension calls or cross visible assistant content and images.
- Change read presentation when `display.groupConsecutiveTools` is disabled.

## Decisions

1. When grouping is enabled, route built-in reads through the existing mixed tool group, including reads of internal URLs. Do not retain a separate read group across other calls: that would obscure their chronological order.
2. Reuse the existing read renderer and image attachment behavior for grouped results. Preserve the read preview setting and result staging rather than replacing reads with generic text. The group expansion action reveals calls in order; tool-output expansion remains independent.
3. Apply the same eligibility and run-break rules in the live controller, main-session rebuild, and shared transcript builder. Associate results and retries with their call IDs so a late result updates its original group without discarding siblings.
4. With grouping disabled, retain the existing dedicated read and standalone internal-URL rendering paths. Existing user-visible text, image, and extension boundaries remain unchanged.

## Risks / Trade-offs

- Read images, previews, usage placement, and partial arguments have specialized paths. Moving reads into mixed groups must preserve those paths, including late and out-of-order results.
- A collapsed group hides earlier summaries until expanded. The existing failure marker must still expose any failed read.
- Live and rebuilt transcripts have separate orchestration. Regression coverage must exercise both and the shared transcript builder.
