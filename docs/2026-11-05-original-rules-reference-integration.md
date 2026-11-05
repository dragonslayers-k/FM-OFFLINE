# FM Original Rules & External Reference Integration Guide

- Date: 2026-11-05
- Repository: `dragonslayers-k/FM-OFFLINE`
- This document is an implementation-side companion to the CardDB reference registry.
- The CardDB's DB29 remains immutable; this document does not authorize a DB30 release or merge.

## Reference inputs to incorporate

1. NamuWiki [Fantasy Masters overview](https://namu.wiki/w/%ED%8C%90%ED%83%80%EC%A7%80%20%EB%A7%88%EC%8A%A4%ED%84%B0%EC%A6%88), including sections 3.4 attributes, 3.5 races/factions, 3.6 cards and its eight attribute subcategories. Follow linked card, skill, and system pages and preserve the link lineage in the reference index.
2. User-provided Naver Blog [original guide](https://m.blog.naver.com/jlplace/220468684977), including attached screenshots. OCR text is evidence only when visually readable; uncertain characters/values remain unverified.
3. Additional original Fantasy Masters guides, analyses, card databases, and personal sites. Register URL, author/site, publication or capture date, card ID/name mapping, excerpt, topic, evidence state, and whether it is reference-only or runtime-validated.
4. Use archived/old articles as historical evidence. Do not silently treat an early ruleset as the final client ruleset.

## Source/evidence model

Separate each rule into:
- `card_source_text`: verbatim card text and source ID
- `primary_reference`: original/official or direct source when available
- `community_reference`: wiki, blog, personal site, guide
- `inference`: explicit reasoning that is not a source quote
- `engine_observation`: reproducible behavior from engine/client tests

Do not promote a community description or OCR fuzzy match into a runtime rule without matching card identity and verifying the exact condition/target/timing/cost. Conflicts and unresolved data remain pending and non-executable.

## Runtime mechanics the engine must model explicitly

- Card classes: land, unit, item, magic, enchant. Preserve enchant as a persistent slot-bound effect, not a generic one-shot spell; support documented exceptions as card-specific rules.
- Unit properties and combat: AP/DP/HP, attack/defense turn context, damage order, and when combat stats reset or persist must be modeled separately. A generic formula from a historical source is a test hypothesis until verified against DB text and engine behavior.
- Unit ability profiles: distinguish unit categories (e.g., equipment/magic/beast/all-purpose where supported), race and faction. Do not infer item compatibility from race/faction or names alone.
- Soul costs: represent elemental and neutral soul components, upkeep, upgrade/discount behavior, hybrid/NCS/BONUS semantics as separate explicit data. Do not collapse card printed cost, effective cost, and ongoing upkeep.
- Card effects: separate trigger, condition, target selection, amount/formula, duration, affected scope, phase/turn, status/state change, destruction/replacement, and randomization/order rules.
- Reference-list and named-effect strings: resolve them through a source-linked definition. An enumerated list is not itself an executable effect. Preserve original sequence and distinguish list membership from effect ordering.
- Persistent or transformed effects: track original vs changed skill, temporary vs permanent, image/art transformation separate from rules, and reversibility/replacement behavior.
- Counters/areas: explicit counter identity, ownership, slot/area, consume/replace/update behavior, duration, and interaction ordering. If a source only says a counter name, do not infer those semantics.
- Card upgrades/variants: use stable card ID and version evidence; never merge variants based on near-identical names.
- Random/coin outcomes: use deterministic test injection for each outcome. Never test only expected-average or success outcomes.
- Stack/order and target constraints: model in explicit rule data and add tests for boundary cases, empty hand/field, unavailable targets, and opposing/own sides.

## Implementation acceptance checklist

For each new rule:
1. Source ID + URL is attached.
2. Exact card ID and original text are preserved.
3. Timing, condition, target, amount/formula, duration, scope, cost, and order are independently represented where applicable.
4. Evidence status and version/date are visible.
5. A behavior test covers normal case and relevant boundaries.
6. No unresolved conflict is silently executable.
7. Existing CardDB / APK compatibility tests pass.
8. Any discrepancy is logged with expected/observed behavior and source lineage.

## Workflow alignment

Work in a feature/documentation branch. Do not modify CardDB's immutable DB29 from this repository. Do not make releases or merge to the default branch without explicit approval. Use focused tests after each data/rule batch; full integration checks are reserved for a completed batch to avoid repetitive Actions churn.
