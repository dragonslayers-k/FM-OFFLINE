# Original Fantasy Masters Reference Review Checklist

Companion source: [CardDB operating guide](https://github.com/dragonslayers-k/T/blob/feat/carddb-effect-semantic-pass/docs/2026-11-05-external-reference-operating-guide.md).

## Source walk-through ledger

- [ ] NamuWiki overview: record game systems, version/time qualifications, source page date.
- [ ] Section 3.4 attributes: collect all linked attribute pages and record taxonomy claims.
- [ ] Section 3.5 races/factions: collect linked race/faction pages; distinguish race, faction, and unit category.
- [ ] Section 3.6 cards: visit eight attribute card indexes; preserve page list and every card-link target.
- [ ] Follow skill/system/card detail links from the main article and relevant card pages; log parent-to-child URL lineage.
- [ ] Read user-supplied Naver blog guide and its images. Transcribe only visually supported text; mark OCR uncertain glyphs as unresolved.
- [ ] Search and register additional personal sites with source URL, owner/site, capture date, scope, and evidence state.
- [ ] Map candidate statements to exact CardDB card IDs and original TextBase/TextExtra.
- [ ] Mark source conflict or historical ruleset uncertainty; never resolve silently.
- [ ] Add focused engine tests before promoting any rule to executable.

## Engine validation for shared Disenchant definition

Source text observed in DB29 TextExtra describes destruction of the first enchant on each side during the enchant activation phase, scaled by the number of Disenchant cards; the example states one on each side for one card. A linked review manifest retains 23 card occurrences:

- [Disenchant source enrichment JSON](https://github.com/dragonslayers-k/T/blob/docs/external-reference-source-guide-2026-11-05/data/reviews/fm1-carddb-29-disenchant-definition-enrichment-2026-11-05.json)

Required tests before runtime implementation:
- one Disenchant, one enchant each side;
- multiple Disenchant counts and fewer-than-count enchantments;
- ordered slots with gaps;
- both sides independently selected;
- simultaneous/multiple Disenchant interactions;
- destruction vs regeneration/replacement and card-specific failure rules;
- destruction of unit vs enchant, including HP and graveyard handling.

Status: pending engine validation. Do not set executable solely from reference text.
