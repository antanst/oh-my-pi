# Proposal

## Why

Read calls split otherwise compact tool activity into many transcript cards. A mixed run should remain compact while preserving access to every call.

## What Changes

- Include built-in read calls, including internal URL reads such as `skill://`, in mixed tool groups when `display.groupConsecutiveTools` is enabled.
- Preserve call order in expanded groups and retain read results, errors, previews, and images.
- Apply the same grouping rules to live activity and rebuilt transcripts. Keep session history and model context unchanged.
- Retain current read rendering when the setting is disabled. Keep existing visible-content and extension boundaries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tool-transcript-grouping`: Include reads in mixed built-in tool runs rather than treating them as group boundaries.

## Impact

The interactive transcript, transcript rebuild paths, tool-group rendering, and their tests change. The persisted session format and tool execution do not change.
