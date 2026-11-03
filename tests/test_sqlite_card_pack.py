import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fm1-offline" / "build-firestore-card-pack.py"
SPEC = importlib.util.spec_from_file_location("fm1_pack_converter", SCRIPT)
CONVERTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONVERTER)


class SqliteCardPackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "cards.sqlite"
        self.db = sqlite3.connect(self.db_path)
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
        CREATE TABLE cards(
          card_id TEXT PRIMARY KEY, name TEXT NOT NULL, card_type TEXT, attribute TEXT,
          source_list_url TEXT NOT NULL, source_card_url TEXT, raw_payload_json TEXT NOT NULL,
          collected_at TEXT
        );
        CREATE TABLE card_costs(
          card_id TEXT PRIMARY KEY, lp_value REAL, lp_known INTEGER, soul_json TEXT,
          soul_known INTEGER, semantic_review INTEGER, mapping_review INTEGER,
          source_text TEXT, verification_status TEXT
        );
        CREATE TABLE card_fields(field_id INTEGER PRIMARY KEY, card_id TEXT, field_key TEXT);
        CREATE TABLE card_images(
          card_id TEXT, image_type TEXT, source_url TEXT, local_path TEXT, archive_path TEXT,
          mime_type TEXT, byte_size INTEGER, sha256 TEXT, download_status TEXT
        );
        CREATE TABLE card_effect_candidate_summaries(
          candidate_id INTEGER PRIMARY KEY, card_id TEXT, text_type TEXT, source_text_sha256 TEXT,
          source_detail_url TEXT, source_text_class_candidate TEXT,
          topic_candidates_json TEXT, trigger_candidates_json TEXT,
          actor_candidates_json TEXT, target_candidates_json TEXT, operation_candidates_json TEXT,
          number_candidates_json TEXT, special_token_candidates_json TEXT, analysis_json TEXT,
          verification_status TEXT, span_integrity_status TEXT
        );
        CREATE TABLE card_effect_clauses(
          candidate_id INTEGER, card_id TEXT, clause_index INTEGER, start_char INTEGER, end_char INTEGER,
          segment_type TEXT, segment_text TEXT, topic_candidates_json TEXT,
          trigger_candidates_json TEXT, actor_candidates_json TEXT, target_candidates_json TEXT,
          operation_candidates_json TEXT, verification_status TEXT
        );
        CREATE TABLE game_rule_catalog(
          rule_id TEXT PRIMARY KEY, rule_family TEXT, canonical_name TEXT, aliases_json TEXT,
          definition_json TEXT, source_authority TEXT, confidence TEXT, verification_status TEXT,
          implementation_status TEXT, source_references_json TEXT, source_conflicts_json TEXT,
          playable_by_default INTEGER, catalogue_version INTEGER
        );
        CREATE TABLE card_rule_mappings(
          card_id TEXT REFERENCES cards(card_id), source_field TEXT, source_enum_value TEXT,
          source_name TEXT, rule_id TEXT REFERENCES game_rule_catalog(rule_id),
          mapping_status TEXT, confidence TEXT, evidence_references_json TEXT,
          PRIMARY KEY(card_id,source_field)
        );
        CREATE TABLE skill_enum_inventory(
          source_field TEXT, source_enum_value TEXT, source_name TEXT, card_count INTEGER,
          mapped_card_count INTEGER, manual_verified_card_count INTEGER,
          community_candidate_card_count INTEGER, mapping_status TEXT, rule_id TEXT,
          PRIMARY KEY(source_field,source_enum_value,source_name)
        );
        """)
        self.card_id = "card-unit-1"
        self.detail = f"https://fmlunatic.com/card/{self.card_id}"
        raw = {
            "ID": self.card_id, "Name": "숲의 전사", "Category": 2, "SoulType": 4,
            "RequireSoul": "5102", "ATK": 3, "DEF": 2, "HP": 5,
            "TextBase": "아군 AP+1.", "TextExtra": "추가 설명"
        }
        self.db.execute(
            "INSERT INTO cards VALUES(?,?,?,?,?,?,?,?)",
            (self.card_id, raw["Name"], "유닛", "숲", "https://fmlunatic.com/cardlist",
             self.detail, json.dumps(raw, ensure_ascii=False), "2026-11-03T00:00:00Z")
        )
        soul = {
            "raw": "5102",
            "colors": {"dark":0,"fire":0,"earth":0,"water":0,"forest":0,"iron":2,"light":0,"neutral":0,"ncs":0,"bonus":0},
            "tokens": [{"raw":"5102","code":51,"count":2,"symbol":"IRON","icon":"/iron.webp","normalized_color":"iron","status":"enum_decoded"}],
            "known": True, "mapping_review": False, "semantic_review": False, "error_reason": None
        }
        self.db.execute(
            "INSERT INTO card_costs VALUES(?,?,?,?,?,?,?,?,?)",
            (self.card_id, None, 0, json.dumps(soul), 1, 0, 0, "5102", "enum_decoded")
        )
        for image_type in ("small", "large"):
            self.db.execute(
                "INSERT INTO card_images VALUES(?,?,?,?,?,?,?,?,?)",
                (self.card_id, image_type,
                 f"https://storage.googleapis.com/fmdb-bcb70.appspot.com/{image_type}/{self.card_id}.webp",
                 None, f"./{image_type}/{self.card_id}.webp", "image/webp", 100,
                 ("a" if image_type=="small" else "b")*64, "archive_verified")
            )
        analysis = {
            "clause_candidates":[{"clause_index":0,"start_char":0,"end_char":10,"text":"아군 AP+1."}],
            "topic_candidates":["stat_ap"]
        }
        self.db.execute(
            "INSERT INTO card_effect_candidate_summaries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (1, self.card_id, "card_text", "c"*64, self.detail, "effect_text_candidate",
             '["stat_ap"]','[]','["friendly"]','[]','["stat_modify"]','["1"]','[]',
             json.dumps(analysis, ensure_ascii=False), "pattern_candidate", "exact")
        )
        self.db.execute(
            "INSERT INTO card_effect_clauses VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (1,self.card_id,0,0,8,"clause","아군 AP+1.",'["stat_ap"]','[]',
             '["friendly"]','[]','["stat_modify"]',"pattern_candidate")
        )
        self.db.execute("INSERT INTO game_rule_catalog VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(
            "defense_bypass","unit_special_skill","방어무시",'["방어무시"]',
            '{"kind":"direct_hp_damage","formula":"attacker.ap"}',
            "manual","high","manual_verified","pending_engine_test",
            '[{"member":"specialability.htm"}]','[]',0,1
        ))
        self.db.execute("INSERT INTO game_rule_catalog VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(
            "strong_fear","unit_special_skill","강한공포",'["강한공포"]',
            '{"kind":"bonus_damage","amount":2}',
            "community","medium","community_documented_candidate","not_implemented",
            '[{"url":"https://www.inven.co.kr/board/hs/3509/1426815"}]','[]',0,1
        ))
        self.db.execute("INSERT INTO card_rule_mappings VALUES(?,?,?,?,?,?,?,?)",(
            self.card_id,"Skill1","243","방어무시","defense_bypass","manual_verified","high",
            '[{"member":"specialability.htm"}]'
        ))
        self.db.execute("INSERT INTO card_rule_mappings VALUES(?,?,?,?,?,?,?,?)",(
            self.card_id,"Skill2","800","강한공포","strong_fear","community_documented_candidate","medium",
            '[{"url":"https://www.inven.co.kr/board/hs/3509/1426815"}]'
        ))
        self.db.execute("INSERT INTO skill_enum_inventory VALUES(?,?,?,?,?,?,?,?,?)",(
            "Skill1","243","방어무시",1,1,1,0,"manual_verified","defense_bypass"
        ))
        self.db.execute("INSERT INTO skill_enum_inventory VALUES(?,?,?,?,?,?,?,?,?)",(
            "Skill2","800","강한공포",1,1,0,1,"community_documented_candidate","strong_fear"
        ))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_db_iron_key_is_translated_to_android_metal(self):
        row = self.db.execute("SELECT * FROM card_costs").fetchone()
        names = [x[1] for x in self.db.execute("PRAGMA table_info(card_costs)")]
        parsed = CONVERTER.db_cost_to_app(dict(zip(names, row)))
        self.assertTrue(parsed["known"])
        self.assertEqual(parsed["cost"], {"metal": 2})
        self.assertEqual(parsed["sourceStatus"], "enum_decoded")

    def test_hybrid_mapping_review_is_not_a_playable_cost(self):
        row = self.db.execute("SELECT * FROM card_costs").fetchone()
        names = [x[1] for x in self.db.execute("PRAGMA table_info(card_costs)")]
        values = dict(zip(names, row))
        soul = json.loads(values["soul_json"])
        soul["colors"]["forest"] = 1
        soul["colors"]["iron"] = 1
        values["soul_json"] = json.dumps(soul)
        values["mapping_review"] = 1
        values["verification_status"] = "mapping_review"
        parsed = CONVERTER.db_cost_to_app(values)
        self.assertFalse(parsed["known"])
        self.assertEqual(parsed["cost"], {})
        self.assertEqual(parsed["candidateCost"], {"forest": 1, "metal": 1})
        self.assertTrue(parsed["mappingReview"])

    def test_ncs_semantics_review_is_not_treated_as_neutral_or_free(self):
        row = self.db.execute("SELECT * FROM card_costs").fetchone()
        names = [x[1] for x in self.db.execute("PRAGMA table_info(card_costs)")]
        values = dict(zip(names, row))
        soul = json.loads(values["soul_json"])
        soul["colors"]["ncs"] = 1
        soul["colors"]["neutral"] = 1
        values["soul_json"] = json.dumps(soul)
        values["semantic_review"] = 1
        values["verification_status"] = "semantic_review"
        parsed = CONVERTER.db_cost_to_app(values)
        self.assertFalse(parsed["known"])
        self.assertEqual(parsed["cost"], {})
        self.assertEqual(parsed["specialSouls"]["ncs"], 1)

    def test_load_reads_exact_url_image_hash_and_effect_candidates_from_sqlite(self):
        rows = CONVERTER.load_normalized_database(self.db_path, expected_count=1)
        self.assertEqual(len(rows), 1)
        card = rows[0]
        self.assertEqual(card["source_card_url"], self.detail)
        self.assertEqual(card["source_image_urls"]["large"].split("/")[-1], self.card_id + ".webp")
        self.assertEqual(card["source_image_metadata"]["large"]["sha256"], "b"*64)
        self.assertEqual(card["effect_candidates"][0]["verificationStatus"], "pattern_candidate")
        self.assertEqual(card["effect_candidates"][0]["clauses"][0]["text"], "아군 AP+1.")
        self.assertEqual(len(card["skill_mappings"]), 2)
        by_field = {x["sourceField"]:x for x in card["skill_mappings"]}
        self.assertEqual(by_field["Skill1"]["ruleId"], "defense_bypass")
        self.assertEqual(by_field["Skill1"]["mappingStatus"], "manual_verified")
        self.assertEqual(by_field["Skill2"]["ruleId"], "strong_fear")
        self.assertEqual(by_field["Skill2"]["mappingStatus"], "community_documented_candidate")
        self.assertEqual(by_field["Skill2"]["ruleAuthority"], "community")


    def test_skill2_catalogue_remains_separate_even_if_a_candidate_rule_id_exists(self):
        mappings = [
            {
                "cardId": self.card_id,
                "sourceField": "Skill2",
                "sourceEnumValue": "800",
                "sourceName": "강한공포",
                "mappingStatus": "community_documented_candidate",
                "ruleId": "strong_fear"
            },
            {
                "cardId": self.card_id,
                "sourceField": "Skill1",
                "sourceEnumValue": "243",
                "sourceName": "방어무시",
                "mappingStatus": "manual_verified",
                "ruleId": "defense_bypass"
            }
        ]
        cards = [{
            "id": self.card_id,
            "name": "숲의 전사",
            "sourceCardUrl": self.detail,
            "sourceListUrl": "https://fmlunatic.com/cardlist",
            "specialSkill1": "방어무시",
            "text": "원본 카드 텍스트"
        }]
        catalogue = CONVERTER.build_skill2_catalogue(mappings, cards, "test-release")
        self.assertEqual(catalogue["sourceField"], "Skill2")
        self.assertEqual(catalogue["entryCount"], 1)
        self.assertEqual(catalogue["activeSkillCount"], 1)
        self.assertEqual(catalogue["activeCardCount"], 1)
        self.assertEqual(catalogue["executableRuleCount"], 0)
        entry = catalogue["records"][0]
        self.assertEqual(entry["name"], "강한공포")
        self.assertIsNone(entry["ruleId"])
        self.assertIsNone(entry["ruleAuthority"])
        self.assertEqual(entry["sourceCandidateRuleIds"], ["strong_fear"])
        self.assertEqual(entry["executionStatus"], "disabled-until-skill2-rule-review")
        self.assertEqual(entry["cardReferences"][0]["sourceCardUrl"], self.detail)
        self.assertEqual(entry["cardReferences"][0]["skill1"], "방어무시")


    def test_four_card_source_verified_skill2_rules_require_exact_description_evidence(self):
        cases = [
            ("701","기선제압","데미지를 1 덜 받는다","skill2_tactical_initiative"),
            ("702","헌신방어","아군 필드 다음 유닛 공방체 +1","skill2_devoted_defense"),
            ("703","격노","자신의 HP가 깎인 수치만큼 AP 상승","skill2_frenzy_defense"),
            ("704","홀리오오라","방/체 합 1/2 이하","skill2_holy_aura"),
            ("705","얼라이디펜스","자신과 동일한 소속의 필드 유닛 수 만큼 받는 데미지 감소","skill2_alliance_defense"),
            ("706","레이셜디펜스","자신과 동일한 종족의 필드 유닛 수 만큼 받는 데미지 감소","skill2_racial_defense"),
            ("707","강한헌신방어","아군 필드 유닛 전체의 공방체가 1증가한다","skill2_strong_devoted_defense"),
            ("708","프레셔","아군 필드 빈공간수 절반(내림) 만큼 받은 데미지를 감소시킨다","skill2_pressure_defense"),
        ]
        mappings = []
        cards = []
        for enum_value, name, evidence, _rule_id in cases:
            card_id = "card-skill2-" + enum_value
            mappings.append({
                "cardId":card_id,"sourceField":"Skill2","sourceEnumValue":enum_value,
                "sourceName":name,"mappingStatus":"unmapped","ruleId":None
            })
            cards.append({
                "id":card_id,"name":"검증 카드 "+name,
                "sourceCardUrl":"https://fmlunatic.com/card/"+card_id,
                "sourceListUrl":"https://fmlunatic.com/cardlist",
                "specialSkill1":"일반공격기술","text":"",
                "description":name+"<br>"+evidence,
                "ap":3,"dp":2,"hp":5
            })
        catalogue = CONVERTER.build_skill2_catalogue(mappings,cards,"test-release")
        self.assertEqual(catalogue["entryCount"],8)
        self.assertEqual(catalogue["executableRuleCount"],8)
        entries = {x["name"]:x for x in catalogue["records"]}
        for _enum_value,name,evidence,rule_id in cases:
            entry = entries[name]
            self.assertEqual(entry["ruleId"],rule_id)
            self.assertEqual(entry["ruleAuthority"],"card_source")
            self.assertEqual(entry["verificationStatus"],"source_card_verified")
            self.assertEqual(entry["executionStatus"],"source-card-rule-implemented")
            self.assertEqual(entry["cardReferences"][0]["sourceCardUrl"],cards[cases.index((_enum_value,name,evidence,rule_id))]["sourceCardUrl"])
            self.assertTrue(any(evidence in ref["description"] for ref in entry["cardReferences"]))

    def test_load_refuses_missing_or_fabricated_card_url(self):
        self.db.execute("UPDATE cards SET source_card_url=? WHERE card_id=?", (
            "https://fmlunatic.com/card/other-id", self.card_id
        ))
        self.db.commit()
        with self.assertRaisesRegex(RuntimeError, "does not match DB ID"):
            CONVERTER.load_normalized_database(self.db_path, expected_count=1)


if __name__ == "__main__":
    unittest.main()
