# External Reference Capture — 2026-11-05

This capture complements `docs/2026-11-05-original-rules-reference-integration.md`.

## Source observations and boundaries

| Source | Observation | Status / boundary |
|---|---|---|
| [NamuWiki Fantasy Masters overview mirror](https://namu.moe/w/판타지%20마스터즈) | Seven base attributes; later neutral attribute described as an eighth; contains sections for attributes, races/factions, and card sublists. | Partial search capture. Mirror may differ from canonical NamuWiki and its full internal link graph is not yet reviewed. |
| [NamuWiki attributes](https://dark.namu.moe/w/판타지마스터즈/속성) | Attribute-specific strategy and historical commentary. | Community interpretation, not normative rules. |
| [NamuWiki Forest Worm](https://www.namu.moe/w/포레스트웜) | Card metadata excerpt includes forest, episode 1, beast/worm, level and stats/skill. | Exact DB29 card ID and historical version remain to be verified. |
| [NamuWiki Frog Transformation](https://d.namu.moe/w/개구리변신) | Community description records a defensive magic and target-category changes before/after recall. | Keep each version claim separately; no unversioned runtime rule. |
| [Neginote guide](https://neginote.wixsite.com/fantasymasters/main-guide) | Five card types and basic roles including enchant. | Personal guide, version date uncertain. |
| [Seore rules document](https://seore.org/raw/문서%3A판타지%20마스터즈) | Describes land capacity, combat formula, unit categories, item restrictions, persistent enchantment and exceptions. | Formulae and exceptions are test hypotheses until exact DB text and engine behavior corroborate them. |
| [Gamechosun 2002 article](https://www.gamechosun.co.kr/webzine/article/view.php?from=articlelist&no=13712) | Early ruleset overview: seven attributes, four types, combat/coin/rank concepts. | Historical; predates later neutral/enchant systems. |
| [User-provided Naver blog guide](https://m.blog.naver.com/jlplace/220468684977) | User supplied a narrow screenshot; full blog body could not be reliably transcribed in this pass. | Mark unreadable/inaccessible; do not OCR-guess. Request original-resolution screenshots only if required to resolve a specific rule. |

## Specific next integration work

- Map the user's listed cards to stable CardDB IDs, including spelling/OCR collisions and card variants.
- Prioritize the seven named terrain-counter/replacement candidates; preserve Base/Extra name mismatches and test LP threshold/payment, terrain slot, counters and replacement behavior.
- Continue remaining effect references, summon profiles, skills, and soul costs.
- Runtime rule promotion requires source lineage and focused behavior tests; keep unknowns pending/non-executable.
- No release is issued and no DB29 source is changed by this reference capture.
