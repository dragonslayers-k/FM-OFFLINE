# FM-OFFLINE runtime playability gate audit — 2026-11-06

- Repository: dragonslayers-k/FM-OFFLINE
- Inspected branch: feat/combat-event-foundation
- PR: #28 (Open / Draft; do not merge without user approval)
- Inspected HEAD: 1bf65ab2dc80035a6329b10dd8c3b80dffd78114
- Purpose: translate the v4.9 game-play-first policy into an exact implementation backlog. This is a source-code audit, not a claim that the fixes are already implemented.

## 1. Confirmed runtime blockers

The current branch has multiple hard gates that treat missing source verification or unsupported effect parsing as card-use failure. These are not just review labels.

| Area | Current code location | Current behavior | Required v4.9 behavior |
|---|---|---|---|
| Non-land cost | app/src/main/assets/game/rules.js:553-558 | costKnown/costMapped false or missing cost rejects play | Resolve source cost first, otherwise use card-specific inferred/fallback runtime cost; never silently free |
| Unit stats | rules.js:559-560 | Missing/non-positive HP or missing AP/DP rejects unit | Provide card-specific stat overlay from same-family/DB analysis; fallback only if no defensible estimate |
| Land LP/install/production | rules.js:561-580 | Missing LP, install cost, EarnSoul decode, or zero production rejects land | Populate inferred runtime LP/install/production; special MagicLand gets deterministic playable fallback, not ordinary fake production |
| Item equip conditions | rules.js:581-584 and itemMatchesUnit() | Missing or unmapped condition rejects item or every target | Infer the narrowest safe legal target profile; if still unresolved, allow a deterministic conservative fallback target rule and log it |
| Enchant | rules.js playCard() and app.js playSelectedCard() | No event/duration-bound enchant slot handler exists; card-wide rejection is removed | Consume cost and complete action with effect-only fallback until a correct event/duration slot engine exists |
| Spell | rules.js:591-600, applyEffect() | Missing timing/effect/target rejects play | Infer timing/target/effect where supported; otherwise queue/resolve deterministic no-op without blocking card use or turn |
| Skill2 | card-schema.js:301-302, rules.js:533-542 | Non-source-verified mapping is disabled and never dispatched | Keep provenance separate; apply tested inferred mapping or a non-blocking deterministic fallback |
| Unknown upkeep cost | rules.js:836-858 | unitNeutralUpkeep() returns Infinity; payNeutralUpkeep() can end the match because a prior unit has unknown cost | Runtime overlay must always provide finite upkeep cost. A missing provenance flag must never manufacture Infinity or auto-lose a match |

## 2. Current tests encode part of the old blocking policy

The existing tests explicitly expect:
- missing/empty source cost makes FM.playCard() fail (tests/rules.test.cjs, test near line 1284);
- candidate-only enchant receives a terminal fallback disposition and no longer blocks card use;
- unknown Skill2 does not fall through to Skill1 handler (this safety property must remain).

Do not delete these tests without replacement. Rewrite them around the new contract:
- missing source cost plus valid inferred runtime cost is playable and pays that cost;
- missing source cost plus deterministic fallback cost is playable and never free;
- candidate-only enchant with a fallback disposition completes as no-op and leaves no pending action;
- unknown Skill2 never executes as a different Skill1 rule, but does not disable the unit/card;
- missing upkeep provenance cannot cause Infinity or automatic defeat.

## 3. Required architecture change

Separate two decisions currently conflated:
1. Source/review state: whether the original game meaning is verified, pending, disputed, or unknown.
2. Runtime playability: whether the card has a valid runtime profile and every action resolves to a terminal state.

Recommended per-card runtime profile fields:
- runtimeProfileVersion
- runtimeCost and runtimeCostStatus
- runtimeStats for AP/DP/HP/LP and other required numeric fields
- runtimeSkill1 / runtimeSkill2 plus mapping provenance and fallback policy
- runtimeItemCondition
- runtimeEffectDisposition: implemented_verified, implemented_inferred, fallback_noop, not_applicable
- runtimeEffect / runtimeFallback
- inferenceMethod, referenceCardIds, evidenceRefs, confidence, diagnosticTag, testIds

Resolver order: source-verified -> accepted/tested inferred overlay -> deterministic conservative fallback. The original source payload remains immutable.

## 4. Implementation order

1. CardDB runtime overlay first: produce one runtime profile for each of 15,350 DB29 cards; use existing image/manual/web/skill/effect adjudications before calculating new values. Analyze same-rule and same-family cohorts; do not fill all missing costs with zero or all effects with an arbitrary powerful behavior.
2. T-side coverage report: enumerate missing runtime fields and effect dispositions by card ID; distinguish source-confirmed, inferred, and fallback counts.
3. APK adapter: import runtime profile and provenance as a separate layer; preserve DB29 source payload.
4. Engine: update validation, cost payment, unit upkeep, item target selection, spell/enchant resolution, and Skill2 dispatch to consume runtime profiles. No unsupported effect may leave an action unresolved.
5. Tests: replace old block-on-review expectations with payment/terminal-resolution assertions, plus deterministic fixed-seed match tests.
6. Verification: focused Node tests and pack-contract tests first; APK emulator/fixed-seed match only after a new data pack exists. No full audit/release or PR merge without the existing approval gates.

## 5. Scope and current limitations

- This audit confirms code-level gates on PR #28 HEAD, not the number of cards affected in DB29. A card-level count requires the current DB29 SQLite/data-pack inventory.
- No code was changed by this audit note.
- No Actions workflow was manually dispatched or rerun.
- DB29 and Release 29 remain immutable; DB30 remains unpublished.
- PR #28 remains Open/Draft and unmerged.

---

## Implementation follow-up — 2026-11-06 (current PR #28 branch)

The original audit above is a historical snapshot at HEAD `1bf65ab2...`. The following implementation commits are now on the same PR branch; this section supersedes the earlier statement that no fixes were implemented.

- Runtime payment converter: `scripts/fm1-offline/build-firestore-card-pack.py` now preserves source cost fields and emits `runtimeCost`, `runtimeCostStatus`, `runtimeCostInference`, and unit-only `runtimeUpkeepCost`. BONUS is converted to generic neutral one-time payment; its source token identity remains preserved and it is excluded from upkeep. NCS remains generic payment and contributes recurring upkeep only for units.
- Engine: `rules.js` resolves runtime costs before provenance flags, uses finite upkeep fallback, allows MagicLand installation without inventing ordinary production, executes exact simple spells with supported attack/defend/battle-start timing through tested inferred handlers, and completes unsupported spells plus all enchants (until event/duration slot handling exists) through paid deterministic no-op terminal actions.
- Item targeting: `card-schema.js` assigns `fallback_any_unit` when source condition wording cannot be mapped; the UI and rules engine use the same deterministic fallback while preserving a parsed own/enemy owner restriction.
- Effect clauses: the data-pack converter now preserves source clause text/spans and adds `runtimeDisposition=fallback_noop` for each of the 48,281 clauses that does not yet have a verified/inferred handler. This is a terminal fallback, not a claim that the original effect is implemented.
- Validator: source cost review counts remain intact and separate from runtime coverage. It now requires valid payable runtime costs for all 15,350 cards, finite upkeep profiles for all 8,633 units, and a terminal disposition for every effect clause.

### Relevant commits

- Converter runtime-cost and card profile: `988c45282f0c5ae87851c0e2d74a3eb285e69f0f`, `f27569b270d4a0125a4211205647945c957c217f`
- Runtime engine and UI: `2883564108552cb68ceb1fca9ebc34d59634154c`, `d293e26658dbeb026f6950f5a7abb931f017ae8a`, `9e4519e9324fc0bfa74d2e345b6fe87f04eaba3e`
- Regression tests and item schema: `86e51666a92b319e84d723606f4e34cad8e8cbd5`, `fda2c67bb1e206cc214040da6ea9780775f5f26d`, `eea19bd50c26c068b4ce920a5f1e46606bbe7e98`
- Workflow gating and effect-clause dispositions: `38d00c0de0838bc1547c9083a7526e2f72687d6b`, `a35835bf281d3407005aec51fc9298a53346d17e`, validator `8a4def7ad294a0790d44f48db90659b6dcbc3801`

### Validation state

- Actions #270 failed in the old pack validator with 40 item cards whose source target conditions were unmapped. The follow-up schema/runtime fallback and validator changes address that exact class; a new full DB29 pack run is still required.
- Actions #276 / run `42189332608` is a lightweight build run on the preceding HEAD. JavaScript tests and Python converter checks passed; DB29 pack was intentionally skipped. Do not treat it as the full 15,350-card pack validation or emulator smoke.
- Final full pack validation must confirm runtime-ready 15,350/15,350, finite unit upkeep 8,633/8,633, effect-clause disposition 48,281/48,281, and zero card-wide runtime blockers. Only then proceed to one emulator smoke on the same final SHA.

DB29 remains untouched; DB30 remains unpublished; PR #28 remains Open/Draft/unmerged. This section does not certify original semantic accuracy for the fallback clauses or real-device match completion.

## 2026-11-06 follow-up — terminal action probe and CI gates

- The final pack validator now calls the real `FM.playCard()` path once for each of the 15,350 normalized cards using a synthetic player state with sufficient LP/souls/deploy capacity and an appropriate own/enemy target. It checks successful result, hand removal, a type-appropriate terminal zone/queue, and `playedAnyCardThisPhase` completion.
- `runtimeActionAudit` reports attempted/completed/blocked and terminal-state counts by card type. Required final result: 15,350 attempted, 15,350 completed, 0 blocked. This action probe is distinct from the existing cost/stat/target/clause structural checks.
- Item fallback ignores only unsupported source clauses. Any known owner/race/affiliation/allowed-ability restriction is retained in both the engine and target-selection UI; if such a known restriction has no matching unit, the item is not falsely treated as usable on an arbitrary target.
- Simple spell inference is restricted to one exact simple-text clause and a supported attack/defend/battle-start timing. All enchants remain paid terminal no-op until a real event/duration slot engine exists.
- CI cost control: ordinary PR updates run JS/Python checks only. Gradle/APK is opt-in via `[build-apk]` or `[build-card-pack]`; full DB29 pack requires `[build-card-pack]`; emulator install/launch requires both `[build-card-pack]` and `[run-emulator]`. Main pushes continue to build APKs automatically; manual dispatch expensive gates default false.
