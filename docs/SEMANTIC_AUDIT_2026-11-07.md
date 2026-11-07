# FM-OFFLINE / CardDB semantic audit — 2026-11-07

## Scope and safety boundary

This audit rechecked the Dropbox Manual.zip pages `gamerule.htm`, `ready.htm`, `cardtype.htm`, `cardability.htm`, `coin.htm`, and `soulcost.htm`, plus the Firestore enumtable and card source fields. Original source values remain immutable. Unverified interpretations are preserved as review/fallback states rather than promoted to verified semantics.

## Namespace separation

| Data / notation | Meaning | Handling |
|---|---|---|
| User-confirmed N/C/S(82) unit-stat shorthand | N=Normal attack, C=Critical attack, S=Defense; (82)=attack dice 0–8 and defense dice 0–2 | Preserve as a separate notation. No Firestore field mapping has yet been proven. |
| Firestore `RequireSoul` code 82 / enum `NCS` | Candidate cost token for a distinct NCS-soul resource documented by community card-skill references | `community_documented_candidate` / `semantic_review`; runtime blocked until NCS-soul pool and payment rules are verified; never MU/neutral fallback. |
| Firestore `RequireSoul` code 81 / enum `MU` | Candidate crosswalk to Manual's colorless/neutral bead | `implemented_inferred`; generic any-color payment; unit-only upkeep. Icon-to-Manual image match remains pending. |
| Firestore `RequireSoul` code 83 / enum `BONUS` | Separate source token | `semantic_review`; generic payable fallback only; no upkeep. |
| Manual coin expression C | Coin; e.g. C3 throws three coins, 2C3 multiplies the result by two | Separate from the C in N/C/S. One shared toss set applies to AP/DP/HP. |
| Firestore `CoinType` | Operation applied to the coin result: NONE, PLUS, MINUS, X, EQUAL | Source-mapped; tested with Manual's +2C1 AP / -C1 DP example. |
| Firestore `StatType` | AP/DP/HP stat markers and other source marker types | CONST/UP/DOWN map to Manual star/triangle restrictions. Other enum types are retained but not executed without a Manual definition. |
| Firestore `RankType` | Separate rank metadata enum | Not used as a substitute for N/C/S shorthand. |
| `EarnSoulList` | Land soul production | Separate from `RequireSoul` costs and stat notation. |

## Corrected Manual-derived rules

- Opening hand: deal six; if no land appears, return the six and shuffle/deal again. The condition is any land, not a search for a zero-cost land. The deterministic safety fallback must still fill six cards.
- Voluntary reshuffle: return hand to deck, shuffle, burn one card, draw six. It has no guaranteed-land clause.
- Neutral/colorless bead: the Manual permits any generated soul for payment and charges unit-only recurring upkeep. MU(81) is the inferred enum crosswalk; NCS(82) is not substituted.
- Coin system: one coin toss set is shared across AP/DP/HP. Manual example +2C1 AP / -C1 DP is now a regression test.
- Land placement: `gamerule.htm` says one land per turn while `cardtype.htm` describes LP-based multiple placements; this Manual conflict remains explicit. Current one-per-turn behavior is a documented conservative choice, not a reconciled canonical rule.
- Defender +1 generic soul: user-requested balance/house rule, not a Manual rule.

## Corrective code

- CardSchema reparses original `sourceFields.RequireSoul` when loading the existing DB29 pack, so stale generated runtime profiles cannot reintroduce NCS upkeep or both-color hybrid payment.
- App pack builder now emits `sourceStatTech` from `ATKStatType`, `DEFStatType`, and `HPStatType`.
- Only `CONST` (★), `UP` (▲), and `DOWN` (▼) are mapped to Manual-defined change restrictions. `FRONT`, `BACK`, `HAND`, `TURN`, `PLUS`, `MINUS`, and `EQUAL` remain preserved but semantically unimplemented.
- No DB29 mutation, DB30 creation, or PR merge is authorized by this audit.


## Firestore enum raw-code correction

The enumtable's outer map key is an index; the first integer in each enum row is the raw code stored in the card fields. For `StatType`, raw values are 1=NONE, 11=CONST(★), 12=UP(▲), 13=DOWN(▼), 21=FRONT, 22=BACK, 23=HAND, 24=TURN, 31=PLUS, 32=MINUS, 33=EQUAL. For `CoinType`, raw values are 1=NONE, 2=PLUS, 3=MINUS, 4=X, 5=EQUAL. The app parser and regression fixtures now use these raw values. The outer index must never be substituted for the source row value.


### EarnSoul / RequireSoul code-82 namespace split

The Firestore enumtable defines `EarnSoul` raw code 82 as `MU02` (two neutral souls produced per token), while `RequireSoul` raw code 82 is the separate `NCS` token. The user-confirmed `NCS(82)` notation is a third, unrelated unit-stat shorthand (N/C/S with attack dice 0–8 and defense dice 0–2). A fourth literal, `NCS소울`, appears in some `TextExtra` effects and remains a separate source-text resource question. These meanings must never be joined by the shared number/string alone. The app's `parse_earn_soul_list` already decodes `EarnSoul` 8201 as two neutral output; converter self-tests cover it separately from `RequireSoul` 8201 review handling.


## Additional runtime correction — unknown upkeep provenance

The Manual's `soulcost.htm` ties recurring upkeep to the neutral bead on a Unit's source summon cost. The app no longer assumes a one-soul upkeep when a legacy unit has no valid `RequireSoul` provenance and no versioned upkeep overlay. Unknown summon costs are already blocked at play validation; inventing a recurring charge on an existing unit was not a Manual-defined fallback. MU(81) source-backed upkeep remains active for units only.


## 2026-11-07 — Two additional fail-closed corrections

- The app pack converter no longer treats a colors-only legacy `soul_json` summary as source proof when the original `RequireSoul` token list is absent. It preserves the old colors as `legacy-unverified` candidates and blocks payment/upkeep. This prevents a stale NCS-to-neutral summary from silently re-entering the runtime after the raw token has been lost.
- In `card-schema.js`, a non-manual `StatType` such as FRONT/BACK/HAND/TURN/PLUS/MINUS/EQUAL can no longer inherit a marker parsed from display text and become an AP/DP/HP combat restriction. Raw type and icon remain preserved; only source codes 11/12/13 receive Manual-defined ★/▲/▼ runtime behavior.
- Regression coverage: colors-only neutral source without RequireSoul provenance is blocked; FRONT source type clears an otherwise parsed ▲ marker while UP/DOWN remain mapped.


## 2026-11-07 — source-backed namespace example and DB29 fallback test

Firestore card `16112710291` (`구름도시`) provides a cross-check: `RequireSoul="71018101"` encodes LIGHT ×1 + MU ×1 for installation; `EarnSoulList="8201"` uses a different enum where code 82 is MU02 and outputs two neutral/MU souls; `MuSoul=2` matches the output. The card's source TextExtra also states the special land consumes 1 MU soul and 1 colored soul. This confirms that a numeric code must be read with its exact source field and enum namespace. `RequireSoul=8201` remains the distinct NCS cost token and is blocked.

The app normalizer now merges raw `sourceFields` coin data with the derived `sourceCoinTech` object. If the derived object is absent in an older immutable DB29 pack, the raw original fields still drive the shared coin calculation. Regression coverage checks the Manual `+2C1 AP / -C1 DP` one-toss example through `sourceFields` alone.


## 2026-11-07 — NCS-soul resource distinction

A 2017 Inven community card-skill list records NCS소울 as a distinct resource: converting a hand-card YuSoul to NCS, creating or replacing cards with NCS-soul costs, moving captured units to hand using NCS-soul, and consuming NCS-soul to increase upkeep. The app and CardDB now label RequireSoul NCS(82) as a separate NCS-soul candidate instead of treating its meaning as wholly unknown. It remains intentionally blocked: the official pool, generation timing, debit path, and payment rules have not been verified. No generic neutral fallback is allowed. Reference: https://www.inven.co.kr/board/hs/3509/1426815 (community reference; not official Manual).
