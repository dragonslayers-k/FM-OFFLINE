#!/usr/bin/env python3
"""Fail-closed DB29 source-row -> Android card-pack lineage check for priority Skill1 cards."""
import argparse
import json
import sqlite3
from pathlib import Path

EXPECTED = {
    "10020341112": ("은룡의검", "normal_attack", "일반공격"),
    "10091525214": ("블랙유니콘", "piercing_attack", "관통공격"),
    "10091525190": ("이블크로우", "weaken_attack", "약화공격"),
    "10010624589": ("파프니르", "petrify_attack", "석화공격"),
    "10010624551": ("해적전투원", "shield_break", "방패파괴"),
    # The display/source label is compared to the exact DB mapping below rather
    # than guessed here; this rule has legacy aliases in the APK.
    "10010624563": ("리듬포이", "defense_convert", None),
}


def fail(message):
    raise SystemExit("DB29 Skill1 lineage validation FAILED: " + message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--cards-json", required=True)
    parser.add_argument("--release-tag", required=True)
    args = parser.parse_args()
    if args.release_tag != "fm1-carddb-29":
        fail(f"unexpected immutable source release {args.release_tag!r}")

    cards = json.loads(Path(args.cards_json).read_text(encoding="utf-8"))
    if not isinstance(cards, list):
        fail("cards.json must be a JSON array")
    pack = {str(card.get("id")): card for card in cards}
    if len(pack) != len(cards):
        fail("cards.json contains duplicate card IDs")

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        fail("SQLite integrity_check is not ok")

    verified = []
    for card_id, (expected_name, expected_rule, expected_label) in EXPECTED.items():
        row = db.execute(
            """SELECT c.card_id,c.name,c.raw_payload_json,
                      m.source_field,m.source_name,m.rule_id,m.mapping_status,
                      g.source_authority
               FROM cards c
               JOIN card_rule_mappings m ON m.card_id=c.card_id
               LEFT JOIN game_rule_catalog g ON g.rule_id=m.rule_id
               WHERE c.card_id=? AND m.source_field='Skill1'""",
            (card_id,),
        ).fetchall()
        if len(row) != 1:
            fail(f"{card_id}: expected exactly one Skill1 mapping row, found {len(row)}")
        source = row[0]
        if source["name"] != expected_name:
            fail(f"{card_id}: DB name {source['name']!r} != {expected_name!r}")
        if source["rule_id"] != expected_rule:
            fail(f"{card_id}: DB rule_id {source['rule_id']!r} != {expected_rule!r}")
        if source["mapping_status"] != "manual_verified":
            fail(f"{card_id}: mapping status is {source['mapping_status']!r}")
        if source["source_authority"] != "manual":
            fail(f"{card_id}: rule authority is {source['source_authority']!r}")
        if not source["source_name"]:
            fail(f"{card_id}: DB Skill1 source name is empty")
        if expected_label is not None and source["source_name"] != expected_label:
            fail(f"{card_id}: DB Skill1 source name {source['source_name']!r} != {expected_label!r}")

        raw_source = json.loads(source["raw_payload_json"] or "{}")
        card = pack.get(card_id)
        if card is None:
            fail(f"{card_id}: missing from generated cards.json")
        if card.get("name") != expected_name:
            fail(f"{card_id}: pack name {card.get('name')!r} != {expected_name!r}")
        if card.get("specialSkill1") != source["source_name"]:
            fail(f"{card_id}: pack Skill1 label {card.get('specialSkill1')!r} != DB mapping source name {source['source_name']!r}")
        if card.get("specialSkillMappingStatus") != "manual_verified":
            fail(f"{card_id}: pack Manual mapping status was not preserved")
        if card.get("specialSkillRuleAuthority") != "manual":
            fail(f"{card_id}: pack Manual authority was not preserved")
        if card.get("specialSkillRuleId") != expected_rule:
            fail(f"{card_id}: pack rule ID {card.get('specialSkillRuleId')!r} != {expected_rule!r}")
        if card.get("specialSkillExecutionStatus") != "manual-rule-catalogue-mapped":
            fail(f"{card_id}: pack execution metadata is not Manual-catalogue-mapped")
        if card.get("sourceCardUrl") != f"https://fmlunatic.com/card/{card_id}":
            fail(f"{card_id}: source card URL is missing or mismatched")

        # Preserve the original Skill1/Skill2 enum values independently.
        source_fields = card.get("sourceFields") or {}
        if source_fields.get("Skill1") != raw_source.get("Skill1"):
            fail(f"{card_id}: raw Skill1 enum value changed in the pack")
        if source_fields.get("Skill2") != raw_source.get("Skill2"):
            fail(f"{card_id}: raw Skill2 enum value changed in the pack")
        if card.get("specialSkill1EnumValue") != raw_source.get("Skill1"):
            fail(f"{card_id}: Skill1 enum metadata differs from SQLite")
        if card.get("specialSkill2EnumValue") != raw_source.get("Skill2"):
            fail(f"{card_id}: Skill2 enum metadata differs from SQLite")

        verified.append({
            "cardId": card_id,
            "name": expected_name,
            "skill1SourceName": source["source_name"],
            "ruleId": expected_rule,
            "skill2EnumValue": raw_source.get("Skill2"),
            "sourceCardUrl": card["sourceCardUrl"],
        })

    db.close()
    print(json.dumps({
        "status": "PASS",
        "sourceRelease": args.release_tag,
        "cardsChecked": len(verified),
        "checks": [
            "SQLite Skill1 source row",
            "Manual-verified mapping and authority",
            "generated pack Skill1 label and rule ID",
            "source detail URL",
            "independent raw Skill1/Skill2 enum preservation",
        ],
        "cards": verified,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
