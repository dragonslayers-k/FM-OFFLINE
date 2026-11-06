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
    "10010624563": ("리듬포이", "defense_convert", None),
}


def fail(message):
    raise SystemExit("DB29 Skill1 lineage validation FAILED: " + message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--cards-json", required=True)
    parser.add_argument("--skill-mappings-json")
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

    mapping_path = (
        Path(args.skill_mappings_json) if args.skill_mappings_json
        else Path(args.cards_json).with_name("fm1-app-skill-mappings.json")
    )
    if not mapping_path.is_file():
        fail(f"card-skill-mappings.json is unavailable: {mapping_path}")
    mapping_data = json.loads(mapping_path.read_text(encoding="utf-8"))
    if (mapping_data.get("schemaVersion") != 1
            or mapping_data.get("sourceDatabaseRelease") != args.release_tag
            or not isinstance(mapping_data.get("records"), list)
            or mapping_data.get("recordCount") != len(mapping_data["records"])):
        fail("card-skill-mappings.json schema, release tag, or record count mismatch")
    mappings_by_card = {}
    for mapping in mapping_data["records"]:
        mappings_by_card.setdefault(str(mapping.get("cardId")), []).append(mapping)

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        fail("SQLite integrity_check is not ok")

    verified = []
    for card_id, (expected_name, expected_rule, expected_label) in EXPECTED.items():
        rows = db.execute(
            """SELECT c.card_id,c.name,c.raw_payload_json,
                      m.source_field,m.source_enum_value,m.source_name,m.rule_id,m.mapping_status,
                      g.source_authority
               FROM cards c
               JOIN card_rule_mappings m ON m.card_id=c.card_id
               LEFT JOIN game_rule_catalog g ON g.rule_id=m.rule_id
               WHERE c.card_id=? AND m.source_field='Skill1'""",
            (card_id,),
        ).fetchall()
        if len(rows) != 1:
            fail(f"{card_id}: expected exactly one Skill1 mapping row, found {len(rows)}")
        source = rows[0]
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

        pack_skill1_rows = [
            m for m in mappings_by_card.get(card_id, [])
            if m.get("sourceField") == "Skill1"
        ]
        if len(pack_skill1_rows) != 1:
            fail(f"{card_id}: expected exactly one Skill1 row in card-skill-mappings.json, found {len(pack_skill1_rows)}")
        pack_mapping = pack_skill1_rows[0]
        if pack_mapping.get("sourceName") != source["source_name"]:
            fail(f"{card_id}: pack mapping sourceName {pack_mapping.get('sourceName')!r} != SQLite {source['source_name']!r}")
        if pack_mapping.get("ruleId") != expected_rule:
            fail(f"{card_id}: pack mapping ruleId {pack_mapping.get('ruleId')!r} != {expected_rule!r}")
        if pack_mapping.get("mappingStatus") != "manual_verified":
            fail(f"{card_id}: pack mapping status is not Manual-verified")
        if pack_mapping.get("ruleAuthority") != "manual":
            fail(f"{card_id}: pack mapping authority is not Manual")
        if str(pack_mapping.get("sourceEnumValue")) != str(raw_source.get("Skill1")):
            fail(f"{card_id}: pack mapping Skill1 enum value differs from SQLite")

        # Skill1 source mappings exist for some non-unit card categories too.
        # The Android card model intentionally activates Skill1 runtime metadata
        # only for units; non-unit mappings remain in the dedicated audit file.
        if card.get("type") == "unit":
            if card.get("specialSkillMappingStatus") != "manual_verified":
                fail(f"{card_id}: unit Skill1 mapping status {card.get('specialSkillMappingStatus')!r} is not Manual-verified")
            if card.get("specialSkillRuleAuthority") != "manual":
                fail(f"{card_id}: unit Skill1 rule authority {card.get('specialSkillRuleAuthority')!r} is not Manual")
            if card.get("specialSkillRuleId") != expected_rule:
                fail(f"{card_id}: unit Skill1 rule ID {card.get('specialSkillRuleId')!r} != {expected_rule!r}")
            if card.get("specialSkillExecutionStatus") != "manual-rule-catalogue-mapped":
                fail(f"{card_id}: unit Skill1 execution metadata is not Manual-catalogue-mapped")
        else:
            if card.get("specialSkillExecutionStatus") != "metadata-only":
                fail(f"{card_id}: non-unit Skill1 must remain metadata-only, got {card.get('specialSkillExecutionStatus')!r}")
            if card.get("specialSkillRuleId") is not None or card.get("specialSkillRuleIds"):
                fail(f"{card_id}: non-unit Skill1 mapping leaked into executable card rule fields")
        if card.get("sourceCardUrl") != f"https://fmlunatic.com/card/{card_id}":
            fail(f"{card_id}: source card URL is missing or mismatched")

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
            "skill1DisplayLabel": card.get("specialSkill1"),
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
            "generated card-skill-mappings.json source name and rule ID",
            "cards.json runtime metadata and source detail URL",
            "independent raw Skill1/Skill2 enum preservation",
        ],
        "cards": verified,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
