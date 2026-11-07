#!/usr/bin/env python3
"""Verify every DB29 Skill1/Skill2 SQLite mapping row survives Android pack generation."""
import argparse
import json
import sqlite3
from pathlib import Path

EXPECTED_RELEASE = "fm1-carddb-29"
EXPECTED_CARDS = 15350
EXPECTED_MAPPING_ROWS = {"Skill1": 10381, "Skill2": 10381}


def fail(message):
    raise SystemExit("DB29 skill mapping pack lineage validation FAILED: " + message)


def same_enum(left, right):
    if left is None or right is None:
        return left is None and right is None
    return str(left) == str(right)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--cards-json", required=True)
    parser.add_argument("--skill-mappings-json", required=True)
    parser.add_argument("--release-tag", required=True)
    args = parser.parse_args()

    if args.release_tag != EXPECTED_RELEASE:
        fail(f"expected immutable {EXPECTED_RELEASE}, got {args.release_tag!r}")

    cards = json.loads(Path(args.cards_json).read_text(encoding="utf-8"))
    if not isinstance(cards, list) or len(cards) != EXPECTED_CARDS:
        fail(f"expected {EXPECTED_CARDS} cards.json rows")
    cards_by_id = {str(card.get("id")): card for card in cards}
    if len(cards_by_id) != len(cards):
        fail("cards.json contains duplicate card IDs")

    mapping_data = json.loads(Path(args.skill_mappings_json).read_text(encoding="utf-8"))
    if (mapping_data.get("schemaVersion") != 1
            or mapping_data.get("sourceDatabaseRelease") != args.release_tag
            or not isinstance(mapping_data.get("records"), list)
            or mapping_data.get("recordCount") != len(mapping_data["records"])):
        fail("card-skill-mappings.json schema, release tag, or record count mismatch")

    pack_mappings = {}
    for mapping in mapping_data["records"]:
        source_field = mapping.get("sourceField")
        if source_field not in EXPECTED_MAPPING_ROWS:
            continue
        key = (str(mapping.get("cardId") or ""), source_field)
        if not key[0]:
            fail(f"{source_field}: mapping row has no cardId")
        if key in pack_mappings:
            fail(f"{source_field}: duplicate pack mapping for card {key[0]}")
        pack_mappings[key] = mapping

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        fail("SQLite integrity_check is not ok")

    db_rows = db.execute(
        """SELECT c.card_id,c.name,c.raw_payload_json,
                  m.source_field,m.source_enum_value,m.source_name,m.rule_id,
                  m.mapping_status,m.confidence,m.evidence_references_json,
                  g.canonical_name,g.source_authority,g.verification_status,
                  g.implementation_status,g.playable_by_default
           FROM cards c
           JOIN card_rule_mappings m ON m.card_id=c.card_id
           LEFT JOIN game_rule_catalog g ON g.rule_id=m.rule_id
           WHERE m.source_field IN ('Skill1','Skill2')
           ORDER BY c.card_id,m.source_field"""
    ).fetchall()

    counts = {"Skill1": 0, "Skill2": 0}
    db_mapping_keys = set()
    mapping_fields = {
        "sourceEnumValue": "source_enum_value",
        "sourceName": "source_name",
        "ruleId": "rule_id",
        "mappingStatus": "mapping_status",
        "confidence": "confidence",
        "ruleName": "canonical_name",
        "ruleAuthority": "source_authority",
        "ruleVerificationStatus": "verification_status",
        "ruleImplementationStatus": "implementation_status",
    }

    for row in db_rows:
        card_id = str(row["card_id"])
        source_field = str(row["source_field"])
        key = (card_id, source_field)
        if key in db_mapping_keys:
            fail(f"{source_field}: duplicate SQLite mapping for card {card_id}")
        db_mapping_keys.add(key)
        counts[source_field] += 1

        raw_source = json.loads(row["raw_payload_json"] or "{}")
        if not same_enum(row["source_enum_value"], raw_source.get(source_field)):
            fail(f"{card_id}/{source_field}: SQLite mapping enum differs from raw source payload")

        pack_mapping = pack_mappings.get(key)
        if pack_mapping is None:
            fail(f"{card_id}/{source_field}: SQLite mapping is missing from card-skill-mappings.json")

        for pack_key, db_key in mapping_fields.items():
            expected = row[db_key]
            actual = pack_mapping.get(pack_key)
            if pack_key == "sourceEnumValue":
                matches = same_enum(actual, expected)
            else:
                matches = actual == expected
            if not matches:
                fail(f"{card_id}/{source_field}: {pack_key} differs (pack={actual!r}, SQLite={expected!r})")

        expected_evidence = json.loads(row["evidence_references_json"] or "[]")
        if pack_mapping.get("evidenceReferences") != expected_evidence:
            fail(f"{card_id}/{source_field}: evidenceReferences differ from SQLite")
        expected_playable = bool(row["playable_by_default"]) if row["canonical_name"] is not None else False
        if pack_mapping.get("rulePlayableByDefault") is not expected_playable:
            fail(f"{card_id}/{source_field}: rulePlayableByDefault differs from SQLite")

    for source_field, expected_count in EXPECTED_MAPPING_ROWS.items():
        if counts[source_field] != expected_count:
            fail(f"{source_field}: expected {expected_count} SQLite mapping rows, found {counts[source_field]}")

    if db_mapping_keys != set(pack_mappings):
        missing = sorted(db_mapping_keys - set(pack_mappings))[:5]
        extra = sorted(set(pack_mappings) - db_mapping_keys)[:5]
        fail(f"SQLite/pack mapping key sets differ; missing={missing}, extra={extra}")

    card_rows = db.execute(
        "SELECT card_id,name,raw_payload_json FROM cards ORDER BY card_id"
    ).fetchall()
    if len(card_rows) != EXPECTED_CARDS:
        fail(f"expected {EXPECTED_CARDS} SQLite cards, found {len(card_rows)}")

    for row in card_rows:
        card_id = str(row["card_id"])
        raw_source = json.loads(row["raw_payload_json"] or "{}")
        card = cards_by_id.get(card_id)
        if card is None:
            fail(f"{card_id}: missing from generated cards.json")
        if card.get("name") != row["name"]:
            fail(f"{card_id}: card name differs between SQLite and cards.json")
        if card.get("sourceCardUrl") != f"https://fmlunatic.com/card/{card_id}":
            fail(f"{card_id}: source card URL is missing or mismatched")

        source_fields = card.get("sourceFields") or {}
        for source_field in ("Skill1", "Skill2"):
            if not same_enum(source_fields.get(source_field), raw_source.get(source_field)):
                fail(f"{card_id}/{source_field}: raw source field was changed in cards.json")

        if card.get("type") == "unit":
            for source_field, runtime_key in (
                ("Skill1", "specialSkill1EnumValue"),
                ("Skill2", "specialSkill2EnumValue"),
            ):
                if not same_enum(card.get(runtime_key), raw_source.get(source_field)):
                    fail(f"{card_id}/{source_field}: unit runtime enum differs from SQLite raw payload")
        else:
            for runtime_key in ("specialSkill1EnumValue", "specialSkill2EnumValue",
                                "specialSkillRuleId", "specialSkill2RuleId",
                                "specialSkillRuleAuthority", "specialSkill2RuleAuthority"):
                if card.get(runtime_key) is not None:
                    fail(f"{card_id}: non-unit {runtime_key} leaked into unit runtime metadata")
            if card.get("specialSkill1") not in (None, "") or card.get("specialSkill2") not in (None, ""):
                fail(f"{card_id}: non-unit Skill1/Skill2 display labels leaked into unit runtime fields")

    db.close()
    print(json.dumps({
        "status": "PASS",
        "sourceRelease": args.release_tag,
        "cardsChecked": len(card_rows),
        "sqliteSkillMappingRows": counts,
        "packSkillMappingRows": len(pack_mappings),
        "checks": [
            "all SQLite Skill1/Skill2 mapping rows match card-skill-mappings.json",
            "enum values match raw SQLite card payloads",
            "mapping status, confidence, evidence, and rule authority match SQLite",
            "all 15,350 cards preserve raw Skill1/Skill2 source fields",
            "unit runtime enum metadata remains separate for Skill1 and Skill2",
            "non-unit skill fields do not leak into unit runtime metadata",
            "source card URLs and card identities match DB29",
        ],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
