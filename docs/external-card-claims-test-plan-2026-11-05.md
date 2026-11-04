# External Card Claims — Focused Engine Test Plan

Source claims captured in CardDB repository: [claim registry](https://github.com/dragonslayers-k/T/blob/docs/external-reference-source-guide-2026-11-05/data/reviews/fm1-external-card-and-magic-order-claims-2026-11-05.json).

## Required test cases before runtime implementation

### Magic resolution order (community guide claim)
- Compare two spells with different levels: lower level first.
- Equal level: attack-turn player's spell first.
- Dispel tag alone must not be a priority override.
- Confirm against manual and engine logs; personal-guide evidence alone is insufficient.

### Card-specific claims to resolve by exact DB29 ID
- **뿌리침투:** simultaneous removal of first friendly and opposing terrain.
- **숲의지도자:** attack-triggered AP/DP zeroing for all opposing beasts; check duration/reset.
- **짙은안개:** defense counter sets AP to zero on both sides; check timing/scope/duration.
- **폐허의흔적:** graveyard-count-based retrieval of opponent-used magic; verify count formula and sequence (example described as retrieving 3rd–6th of six used spells when four are returned).

For each test, retain source card ID, exact TextBase/TextExtra, version/capture context, expected vs observed behavior, and whether a discrepancy is unresolved. These community claims are non-executable until corroborated.

## Acceptance gate

- No runtime rule is generated from a card name alone.
- Tests cover missing targets, empty/short zones, slot ordering, tied priorities, and state reset.
- No release is issued from this documentation batch.
