# Tasks

## 1. Mixed transcript grouping

- [x] 1.1 Include built-in read calls, including internal URLs, in mixed tool groups when grouping is enabled; preserve current read behavior when disabled.
- [x] 1.2 Update live event handling, main-session rebuilds, and `ChatTranscriptBuilder` to use the same mixed-run boundaries and retain call order.
- [x] 1.3 Preserve read previews, errors, images, usage placement, partial arguments, late results, and retry handling in mixed groups; keep row and output expansion independent.

## 2. Verification and documentation

- [x] 2.1 Update conflicting read-boundary tests and cover mixed ordering, internal URLs, disabled grouping, visible separators, extension calls, and live/rebuild parity.
- [x] 2.2 Cover grouped read failures, image results, preview settings, late results, retries, and expansion behavior at their observable boundaries.
- [x] 2.3 Run focused tests and exercise the mixed group in the actual TUI, including expansion and a rebuilt session.
- [x] 2.4 Update affected user-facing documentation and the relevant package changelog.
