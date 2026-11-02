## Purpose

Keep the main specifications unchanged when an archive destination already exists.

## ADDED Requirements

### Requirement: Archive destination preflight

The archive command and skill SHALL calculate the dated destination and reject an existing destination before synchronizing delta specs. They SHALL also verify the destination immediately before moving the change.

#### Scenario: Destination already exists

- **WHEN** the dated archive destination exists before synchronization
- **THEN** the workflow stops without changing the main specs or moving the change

#### Scenario: Destination appears during synchronization

- **WHEN** the destination appears after preflight but before the archive move
- **THEN** the workflow stops before the move and reports the collision without overwriting the destination
