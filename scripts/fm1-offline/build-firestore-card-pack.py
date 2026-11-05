#!/usr/bin/env python3
"""Convert FM Lunatic Firestore release data into the Android app's FM1-CARD-DATA ZIP."""
import argparse, gzip, hashlib, json, os, shutil, sqlite3, tarfile, zipfile
from collections import Counter
from pathlib import Path, PurePosixPath

TOTAL = 15350
CATEGORY = {1:"land", 2:"unit", 3:"spell", 4:"item", 5:"enchant"}
CATEGORY_PREFIX = {1:"L", 2:"U", 3:"M", 4:"I", 5:"E"}
CATEGORY_KO = {1:"지형", 2:"유닛", 3:"마법", 4:"아이템", 5:"인챈트"}
EXPECTED = Counter({"land":289, "unit":8633, "spell":3857, "item":1748, "enchant":823})
PURE_SOUL = {11:"dark", 21:"fire", 31:"water", 41:"forest", 51:"metal", 61:"earth", 71:"light", 81:"neutral"}

def enum_lookup(data):
    result={}
    for key, raw in data.items():
        if not key.startswith("Enum+"): continue
        rows=raw if isinstance(raw,list) else list(raw.values()) if isinstance(raw,dict) else []
        values={}
        for row in rows:
            if isinstance(row,list) and len(row)>=2:
                values[str(row[0])] = str(row[2] if len(row)>2 and row[2] not in (None,"") else row[1])
            elif isinstance(row,dict):
                code=row.get("KIND",row.get("value",row.get("ID")))
                if code is not None: values[str(code)]=str(row.get("UIName") or row.get("TYPE") or row.get("name") or "")
        result[key.split("+",1)[1]]=values
    return result

def label(lookups, name, value):
    return "" if value is None else lookups.get(name,{}).get(str(value),"")

def enum_symbol_map(data, group_name):
    raw = data.get("Enum+" + group_name, {})
    rows = raw if isinstance(raw, list) else list(raw.values()) if isinstance(raw, dict) else []
    result = {}
    for row in rows:
        if isinstance(row, list) and len(row) >= 2:
            code = str(row[0])
            result[code] = {
                "symbol": str(row[1] or "").upper(),
                "icon": str(row[2] or "") if len(row) > 2 else ""
            }
        elif isinstance(row, dict):
            code = row.get("KIND", row.get("value", row.get("ID")))
            if code is not None:
                result[str(code)] = {
                    "symbol": str(row.get("TYPE") or row.get("name") or row.get("UIName") or "").upper(),
                    "icon": str(row.get("image") or row.get("icon") or "")
                }
    return result

def integer(value):
    if value is None or value=="": return None
    try: return int(float(str(value).replace(",","").strip()))
    except (ValueError,TypeError): return None

def faction(label_text):
    s=str(label_text or "").lower()
    for needles,color in [
        (("dark","암흑","어둠"),"dark"),(("fire","불","화염"),"fire"),
        (("water","물","수속","바다"),"water"),(("forest","숲","자연"),"forest"),
        (("iron","metal","금속","철"),"metal"),(("earth","대지","땅"),"earth"),
        (("light","빛","광명"),"light"),(("mu","neutral","무속성","무"),"neutral")]:
        if any(n in s for n in needles): return color
    return "neutral"

def parse_cost(raw, require_soul_enum):
    """Decode RequireSoul codes, including documented two-colour tokens.
    NCS and BONUS remain review-only until their payment rules are verified.
    """
    out={"cost":{},"known":False,"review":[],"raw":raw,"tokens":[]}
    if not isinstance(raw,str) or not raw:
        out["review"].append("source-cost-missing"); return out
    if len(raw)%4:
        out["review"].append("invalid-token-width"); return out
    values={}
    colors={"DARK":"dark","FIRE":"fire","WATER":"water","FOREST":"forest",
            "IRON":"metal","EARTH":"earth","LIGHT":"light"}
    for i in range(0,len(raw),4):
        token=raw[i:i+4]
        if not token.isdigit():
            out["review"].append("non-numeric-token:"+token); continue
        code,amount=int(token[:2]),int(token[2:])
        meta=require_soul_enum.get(str(code))
        if not meta:
            out["review"].append("unresolved-requiresoul-code:"+token)
            out["tokens"].append({"raw":token,"code":code,"amount":amount,"symbol":None,"status":"manual_review"})
            continue
        symbol=meta["symbol"]
        record={"raw":token,"code":code,"amount":amount,"symbol":symbol,
                "icon":meta.get("icon",""),"status":"enum-decoded"}
        if symbol=="NONE":
            if amount==0:
                values.setdefault("neutral",0)
                record["kind"]="no-cost"
            else:
                record["status"]="manual_review"
                out["review"].append("nonzero-none-token:"+token)
        elif symbol=="MU":
            values["neutral"]=values.get("neutral",0)+amount
            record["kind"]="neutral"
        else:
            components=symbol.split("_")
            if components and all(part in colors for part in components):
                record["kind"]="colored"
                record["colors"]=[colors[part] for part in components]
                for color in record["colors"]:
                    values[color]=values.get(color,0)+amount
            else:
                record["status"]="manual_review"
                out["review"].append("unresolved-requiresoul-symbol:"+symbol)
        out["tokens"].append(record)
    if not out["review"] and values:
        out["cost"]=values;out["known"]=True
    elif not out["review"]:
        out["review"].append("no-recognized-cost-token")
    return out

def parse_earn_soul_list(raw, earn_enum, mu_soul=None):
    """Decode land production from Enum+EarnSoul (not SoulType/MuSoul guesses)."""
    out = {
        "colored": {}, "neutral": 0, "magicLand": False,
        "known": False, "review": [], "tokens": []
    }
    if not isinstance(raw, str) or not raw:
        out["review"].append("source-earn-soul-list-missing")
        return out
    if len(raw) % 4:
        out["review"].append("invalid-token-width")
        return out

    colors = {
        "DARK":"dark", "FIRE":"fire", "WATER":"water",
        "FOREST":"forest", "IRON":"metal", "EARTH":"earth", "LIGHT":"light"
    }
    colored = Counter()
    neutral = 0
    for i in range(0, len(raw), 4):
        token = raw[i:i+4]
        if not token.isdigit():
            out["review"].append("non-numeric-token:" + token)
            continue
        code, amount = int(token[:2]), int(token[2:])
        # Firestore enum keys are numeric codes ("2"), while EarnSoulList
        # serializes fixed-width tokens ("02"). Normalize before lookup.
        meta = earn_enum.get(str(code))
        if not meta:
            out["review"].append("unresolved-earn-soul-code:" + token)
            out["tokens"].append({"raw":token,"code":code,"symbol":None,"amount":amount,"status":"unmapped"})
            continue
        symbol = meta["symbol"]
        record = {
            "raw":token,"code":int(code),"symbol":symbol,"amount":amount,
            "icon":meta.get("icon",""),"status":"enum-decoded"
        }
        if symbol == "NONE":
            record["kind"] = "none"
        elif symbol == "SPELL":
            out["magicLand"] = True
            record["kind"] = "magicland-marker"
        elif symbol == "ALL":
            record["kind"] = "all-colors"
            record["colors"] = list(colors.values())
            for color in colors.values():
                colored[color] += amount
        elif symbol in ("MU01","MU02","MU03"):
            value = int(symbol[-1])
            neutral += value * amount
            record["kind"] = "neutral"
            record["neutralPerToken"] = value
            record["neutralOutput"] = value * amount
        else:
            components = symbol.split("_")
            if components and all(part in colors for part in components):
                output_colors = [colors[part] for part in components]
                record["kind"] = "colored"
                record["colors"] = output_colors
                for color in output_colors:
                    colored[color] += amount
            else:
                record["status"] = "unmapped"
                out["review"].append("unresolved-earn-soul-symbol:" + symbol)
        out["tokens"].append(record)

    expected_mu = integer(mu_soul)
    if expected_mu is not None and neutral != expected_mu and not out["magicLand"]:
        out["review"].append(f"mu-soul-cross-check-mismatch:EarnSoulList={neutral},MuSoul={expected_mu}")
    out["colored"] = {k:v for k,v in colored.items() if v}
    out["neutral"] = neutral
    out["known"] = not out["review"]
    return out

def add(tabs, group, label_text, value):
    if value is None or value=="": return
    tabs.setdefault(group,[]).append({"label":label_text,"text":f"{label_text} : {value}"})

def db_cost_to_app(cost_row):
    """Read the canonical T SQLite status; never infer cost validity from token syntax alone."""
    if cost_row is None:
        return {
            "cost": {}, "candidateCost": {}, "known": False, "mappingReview": False,
            "semanticReview": False, "soulKnown": False, "review": ["database-cost-row-missing"],
            "tokens": [], "sourceStatus": "missing"
        }
    soul=json.loads(cost_row["soul_json"] or "{}")
    colors=soul.get("colors") or {}
    candidate={}
    flexible_special=0
    for key,value in colors.items():
        amount=integer(value)
        if amount is None or not amount:
            continue
        if key in ("ncs","bonus"):
            flexible_special+=amount
            continue
        candidate["metal" if key=="iron" else key]=amount
    if flexible_special:
        candidate["neutral"]=candidate.get("neutral",0)+flexible_special
    mapping_review=bool(cost_row["mapping_review"])
    semantic_review=bool(cost_row["semantic_review"])
    soul_known=bool(cost_row["soul_known"])
    known=soul_known
    review=[]
    if not soul_known:
        review.append("unresolved-source-token")
    if mapping_review:
        review.append("hybrid-playable-inferred-both-colors")
    if semantic_review:
        review.append("special-soul-playable-inferred-flexible-neutral")
    # Preserve an explicit NONE/00 source as a known zero-cost object.
    app_cost=dict(candidate) if known else {}
    if known and not app_cost:
        app_cost={"neutral":0}
    return {
        "cost":app_cost,
        "candidateCost":candidate,
        "known":known,
        "mappingReview":mapping_review,
        "semanticReview":semantic_review,
        "soulKnown":soul_known,
        "review":review,
        "tokens":soul.get("tokens") or [],
        "specialSouls":{k:integer(colors.get(k)) or 0 for k in ("ncs","bonus")},
        "sourceStatus":str(cost_row["verification_status"] or "unknown"),
        "raw":cost_row["source_text"],
    }


def load_normalized_database(db_path, expected_count=TOTAL):
    """Build source records from T's audited SQLite, not a second JSONL re-parser."""
    connection=sqlite3.connect(str(db_path))
    connection.row_factory=sqlite3.Row
    integrity=connection.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity!="ok":
        connection.close()
        raise RuntimeError("T SQLite integrity_check failed: "+str(integrity))
    required_tables={
        "cards","card_costs","card_fields","card_images",
        "card_effect_candidate_summaries","card_effect_clauses",
        "game_rule_catalog","card_rule_mappings","skill_enum_inventory"
    }
    present={row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    missing=required_tables-present
    if missing:
        connection.close()
        raise RuntimeError("T SQLite schema is incomplete: "+", ".join(sorted(missing)))
    cost_rows={
        row["card_id"]:row
        for row in connection.execute("SELECT * FROM card_costs")
    }
    skill_rule_rows={
        row["rule_id"]:row
        for row in connection.execute("SELECT * FROM game_rule_catalog")
    }
    skill_mappings={}
    for mapping in connection.execute("""
        SELECT card_id,source_field,source_enum_value,source_name,rule_id,
               mapping_status,confidence,evidence_references_json
        FROM card_rule_mappings
        ORDER BY card_id,source_field
    """):
        rule=skill_rule_rows.get(mapping["rule_id"])
        skill_mappings.setdefault(str(mapping["card_id"]),[]).append({
            "sourceField":mapping["source_field"],
            "sourceEnumValue":mapping["source_enum_value"],
            "sourceName":mapping["source_name"],
            "ruleId":mapping["rule_id"],
            "mappingStatus":mapping["mapping_status"],
            "confidence":mapping["confidence"],
            "evidenceReferences":json.loads(mapping["evidence_references_json"] or "[]"),
            "ruleName":rule["canonical_name"] if rule else None,
            "ruleAuthority":rule["source_authority"] if rule else None,
            "ruleVerificationStatus":rule["verification_status"] if rule else None,
            "ruleImplementationStatus":rule["implementation_status"] if rule else None,
            "rulePlayableByDefault":bool(rule["playable_by_default"]) if rule else False,
        })
    skill_db_counts={
        "manualRuleCount":connection.execute(
            "SELECT COUNT(*) FROM game_rule_catalog WHERE source_authority='manual'"
        ).fetchone()[0],
        "communityRuleCandidateCount":connection.execute(
            "SELECT COUNT(*) FROM game_rule_catalog WHERE source_authority='community'"
        ).fetchone()[0],
        "cardRuleMappingRows":connection.execute("SELECT COUNT(*) FROM card_rule_mappings").fetchone()[0],
        "manualSkillMappingRows":connection.execute(
            "SELECT COUNT(*) FROM card_rule_mappings WHERE mapping_status='manual_verified'"
        ).fetchone()[0],
        "communitySkillCandidateRows":connection.execute(
            "SELECT COUNT(*) FROM card_rule_mappings WHERE mapping_status='community_documented_candidate'"
        ).fetchone()[0],
        "unmappedSkillRows":connection.execute(
            "SELECT COUNT(*) FROM card_rule_mappings WHERE mapping_status='unmapped'"
        ).fetchone()[0],
        "skillEnumInventoryRows":connection.execute("SELECT COUNT(*) FROM skill_enum_inventory").fetchone()[0],
        "playableCommunityRuleRows":connection.execute(
            "SELECT COUNT(*) FROM game_rule_catalog WHERE source_authority='community' AND playable_by_default=1"
        ).fetchone()[0],
    }
    if skill_db_counts["playableCommunityRuleRows"]!=0:
        connection.close()
        raise RuntimeError("T SQLite has executable community-only skill rules")
    if expected_count==TOTAL and (
        skill_db_counts["manualRuleCount"]!=27 or skill_db_counts["communityRuleCandidateCount"]!=41
        or skill_db_counts["cardRuleMappingRows"]<15000
        or skill_db_counts["manualSkillMappingRows"]<1000
        or skill_db_counts["communitySkillCandidateRows"]<100
        or skill_db_counts["skillEnumInventoryRows"]<100
    ):
        connection.close()
        raise RuntimeError("T SQLite card-level skill mapping validation failed: "+json.dumps(skill_db_counts,ensure_ascii=False))
    skill_rule_rows={
        row["rule_id"]:row
        for row in connection.execute("SELECT * FROM game_rule_catalog")
    }
    skill_mappings={}
    for mapping in connection.execute("""
        SELECT card_id,source_field,source_enum_value,source_name,rule_id,
               mapping_status,confidence,evidence_references_json
        FROM card_rule_mappings
        ORDER BY card_id,source_field
    """):
        rule=skill_rule_rows.get(mapping["rule_id"])
        skill_mappings.setdefault(str(mapping["card_id"]),[]).append({
            "sourceField":mapping["source_field"],
            "sourceEnumValue":mapping["source_enum_value"],
            "sourceName":mapping["source_name"],
            "ruleId":mapping["rule_id"],
            "mappingStatus":mapping["mapping_status"],
            "confidence":mapping["confidence"],
            "evidenceReferences":json.loads(mapping["evidence_references_json"] or "[]"),
            "ruleName":rule["canonical_name"] if rule else None,
            "ruleAuthority":rule["source_authority"] if rule else None,
            "ruleVerificationStatus":rule["verification_status"] if rule else None,
            "ruleImplementationStatus":rule["implementation_status"] if rule else None,
            "rulePlayableByDefault":bool(rule["playable_by_default"]) if rule else False,
        })
    image_rows={}
    for image in connection.execute(
        "SELECT card_id,image_type,source_url,local_path,archive_path,mime_type,byte_size,sha256,download_status "
        "FROM card_images ORDER BY card_id,image_type"
    ):
        image_rows.setdefault(str(image["card_id"]),{})[str(image["image_type"])]={
            "sourceUrl":image["source_url"],
            "localPath":image["local_path"],
            "archivePath":image["archive_path"],
            "mimeType":image["mime_type"],
            "byteSize":image["byte_size"],
            "sha256":image["sha256"],
            "downloadStatus":image["download_status"],
        }
    effect_rows={}
    candidate_objects={}
    for item in connection.execute(
        "SELECT candidate_id,card_id,text_type,source_text_sha256,source_detail_url,"
        "source_text_class_candidate,topic_candidates_json,trigger_candidates_json,"
        "actor_candidates_json,target_candidates_json,operation_candidates_json,"
        "number_candidates_json,special_token_candidates_json,analysis_json,verification_status,"
        "span_integrity_status FROM card_effect_candidate_summaries ORDER BY card_id,candidate_id"
    ):
        candidate_id=int(item["candidate_id"])
        entry={
            "textType":item["text_type"],
            "sourceTextSha256":item["source_text_sha256"],
            "sourceCardUrl":item["source_detail_url"],
            "sourceTextClassCandidate":item["source_text_class_candidate"],
            "topicCandidates":json.loads(item["topic_candidates_json"] or "[]"),
            "triggerCandidates":json.loads(item["trigger_candidates_json"] or "[]"),
            "actorCandidates":json.loads(item["actor_candidates_json"] or "[]"),
            "targetCandidates":json.loads(item["target_candidates_json"] or "[]"),
            "operationCandidates":json.loads(item["operation_candidates_json"] or "[]"),
            "numberCandidates":json.loads(item["number_candidates_json"] or "[]"),
            "specialTokenCandidates":json.loads(item["special_token_candidates_json"] or "[]"),
            "analysis":json.loads(item["analysis_json"] or "{}"),
            "verificationStatus":item["verification_status"],
            "spanIntegrityStatus":item["span_integrity_status"],
            "clauses":[],
        }
        effect_rows.setdefault(str(item["card_id"]),[]).append(entry)
        candidate_objects[candidate_id]=entry
    for clause in connection.execute(
        "SELECT candidate_id,card_id,clause_index,start_char,end_char,segment_type,segment_text,"
        "topic_candidates_json,trigger_candidates_json,actor_candidates_json,target_candidates_json,"
        "operation_candidates_json,verification_status FROM card_effect_clauses "
        "ORDER BY candidate_id,clause_index"
    ):
        card_id=str(clause["card_id"])
        # Candidate text hashes are unique per card/text source row; candidate_id is resolved below.
        candidate_id=int(clause["candidate_id"])
        parent=candidate_objects.get(candidate_id)
        if parent is None:
            raise RuntimeError(f"SQLite effect clause has no candidate parent: {candidate_id}")
        parent["clauses"].append({
            "index":int(clause["clause_index"]),
            "startChar":int(clause["start_char"]),
            "endChar":int(clause["end_char"]),
            "segmentType":clause["segment_type"],
            "text":clause["segment_text"],
            "topicCandidates":json.loads(clause["topic_candidates_json"] or "[]"),
            "triggerCandidates":json.loads(clause["trigger_candidates_json"] or "[]"),
            "actorCandidates":json.loads(clause["actor_candidates_json"] or "[]"),
            "targetCandidates":json.loads(clause["target_candidates_json"] or "[]"),
            "operationCandidates":json.loads(clause["operation_candidates_json"] or "[]"),
            "verificationStatus":clause["verification_status"],
        })
    records=[]
    for item in connection.execute(
        "SELECT card_id,name,card_type,attribute,source_list_url,source_card_url,"
        "raw_payload_json,collected_at FROM cards ORDER BY card_id"
    ):
        cid=str(item["card_id"])
        raw=json.loads(item["raw_payload_json"] or "{}")
        detail=item["source_card_url"]
        expected=f"https://fmlunatic.com/card/{cid}"
        if not detail or detail!=expected:
            raise RuntimeError(f"Card detail URL missing or does not match DB ID: {cid} -> {detail}")
        images=image_rows.get(cid,{})
        if set(images)!={"small","large"}:
            raise RuntimeError(f"Card image metadata incomplete for {cid}: {sorted(images)}")
        if any(
            images[k]["downloadStatus"]!="archive_verified" or not images[k]["sha256"]
            or images[k]["mimeType"]!="image/webp" or not images[k]["archivePath"]
            for k in ("small","large")
        ):
            raise RuntimeError(f"Card image is not archive-verified: {cid}")
        for candidate in effect_rows.get(cid,[]):
            if candidate["sourceCardUrl"]!=detail:
                raise RuntimeError(f"Effect candidate points to the wrong source card URL: {cid}")
            if candidate["verificationStatus"]!="pattern_candidate":
                raise RuntimeError(f"Unexpected executable effect verification status for {cid}")
            if candidate["spanIntegrityStatus"] not in ("exact","not_split"):
                raise RuntimeError(f"Effect candidate has unverified source spans: {cid}")
            if candidate["spanIntegrityStatus"]=="exact":
                original="".join(x.get("text","") for x in candidate["analysis"].get("clause_candidates",[]))
                flattened="".join(x["text"] for x in candidate["clauses"])
                if original!=flattened:
                    raise RuntimeError(f"Effect candidate clause text does not reconstruct source: {cid}")
        record={
            "card_id":cid,
            "name":item["name"],
            "raw_payload":raw,
            "source_list_url":item["source_list_url"],
            "source_card_url":detail,
            "source_image_urls":{k:v["sourceUrl"] for k,v in images.items()},
            "source_image_metadata":images,
            "collected_at":item["collected_at"],
            "normalized_cost":db_cost_to_app(cost_rows.get(cid)),
            "effect_candidates":effect_rows.get(cid,[]),
            "skill_mappings":skill_mappings.get(cid,[]),
        }
        records.append(record)
    fk=connection.execute("PRAGMA foreign_key_check").fetchall()
    connection.close()
    if fk:
        raise RuntimeError(f"T SQLite foreign-key errors: {len(fk)}")
    if len(records)!=expected_count:
        raise RuntimeError(f"T SQLite card count mismatch: {len(records)} / {expected_count}")
    if len(cost_rows)!=expected_count or len(image_rows)!=expected_count:
        raise RuntimeError(
            f"T SQLite cost/image parent counts mismatch: costs={len(cost_rows)} images={len(image_rows)} expected={expected_count}"
        )
    if expected_count==TOTAL and len(skill_mappings)<1000:
        raise RuntimeError(f"T SQLite card rule mapping coverage too low: {len(skill_mappings)}")
    return records


def build_card(row, enums, earn_soul_enum, require_soul_enum):
    f=row.get("raw_payload") or {}
    cid=str(row.get("card_id") or f.get("ID") or "")
    name=str(row.get("name") or f.get("Name") or "")
    cat=integer(f.get("Category"))
    if not cid or not name or cat not in CATEGORY: raise ValueError(f"Invalid card id/name/category: {cid}/{name}/{cat}")
    typ=CATEGORY[cat]; category_name=CATEGORY_KO[cat]
    soul_label=label(enums,"SoulType",f.get("SoulType"))
    color=faction(soul_label)
    tabs={"기타":[],"분류별":[],"텍스트":[]}
    add(tabs,"기타","분류",category_name);add(tabs,"기타","속성",soul_label)
    for field, enum_name, label_name in [
        ("RaceType","RaceType","종족타입"),("CompanyType","CompanyType","소속타입"),
        ("EtcType","EtcType","기타타입"),("RareUI","RareUI","희귀도"),
        ("Episode","Episode","에피소드"),("DeckLimit","DeckLimit","덱 수량제한"),
        ("BuyGrade","BuyGrade","구매등급")]:
        add(tabs,"기타",label_name,label(enums,enum_name,f.get(field)) or f.get(field))
    rd=f.get("ReleaseDate")
    if rd is not None:
        rd=str(rd)
        if len(rd)==8 and rd.isdigit(): rd=f"{rd[:4]}-{rd[4:6]}-{rd[6:]}"
        add(tabs,"기타","발매일",rd)

    base=str(f.get("TextBase") or "")
    extra=str(f.get("TextExtra") or "")
    if base:
        tabs["텍스트"].append({"label":"카드 텍스트","text":base})
        add(tabs,"분류별","카드 텍스트",base)
    if extra: tabs["텍스트"].append({"label":"추가 설명","text":extra})

    c=row.get("normalized_cost") or parse_cost(f.get("RequireSoul"),require_soul_enum)
    cost_known=(c["known"] and typ!="land")
    skill1_name=label(enums,"Skill1",f.get("Skill1"))
    skill2_name=label(enums,"Skill2",f.get("Skill2"))
    source_skill1=next((m for m in (row.get("skill_mappings") or []) if m.get("sourceField")=="Skill1"),None)
    source_skill2=next((m for m in (row.get("skill_mappings") or []) if m.get("sourceField")=="Skill2"),None)
    verified_skill2_spec=verified_skill2_rule_for_card(typ,skill2_name,extra) if source_skill2 is not None else None
    skill2_named=bool(skill2_name and skill2_name!="없음")
    card={
        "id":cid,"name":name,"type":typ,"faction":color,
        "cost":c["cost"] if cost_known else {},
        "costKnown":cost_known,"costMapped":cost_known,
        "costSource":c.get("sourceStatus","legacy-enum-parse"),
        "soulCostRaw":f.get("RequireSoul"),"costReview":c["review"],
        "costReviewStatus":c.get("sourceStatus","legacy-enum-parse"),
        "costMappingReview":bool(c.get("mappingReview",False)),
        "costSemanticReview":bool(c.get("semanticReview",False)),
        "costTokenParsed":bool(c.get("soulKnown",c.get("known",False))),
        "costCandidate":c.get("candidateCost",{}),
        "costTokens":c.get("tokens",[]),
        "specialSoulTokens":c.get("specialSouls",{}),
        "text":base,"description":extra,"tabs":tabs,
        "artImage":cid+".webp",
        "sourceCardUrl":row.get("source_card_url"),
        "sourceListUrl":row.get("source_list_url"),
        "sourceImageUrls":row.get("source_image_urls") or {},
        "sourceImageMetadata":row.get("source_image_metadata") or {},
        "sourceFields":f,"sourceCollectedAt":row.get("collected_at"),
        "sourceDocumentId":cid,
        "effectCandidateCount":len(row.get("effect_candidates") or []),
        "effectExecutionStatus":"candidate-only" if row.get("effect_candidates") else "no-effect-candidate",
        "effectVerificationStatus":"pattern_candidate" if row.get("effect_candidates") else "no-effect-candidate",
        "specialSkill1":skill1_name if typ=="unit" else "",
        "specialSkill2":skill2_name if typ=="unit" else "",
        "specialSkill1EnumValue":f.get("Skill1") if typ=="unit" else None,
        "specialSkill2EnumValue":f.get("Skill2") if typ=="unit" else None,
        "specialSkill2MappingStatus":(
            "source_card_verified" if verified_skill2_spec is not None
            else (source_skill2.get("mappingStatus","unmapped") if typ=="unit" and source_skill2
                  else ("unmapped" if typ=="unit" and skill2_named else "no_special_skill"))
        ),
        "specialSkill2SourceMappingStatus":(
            source_skill2.get("mappingStatus","unmapped") if typ=="unit" and source_skill2
            else ("unmapped" if typ=="unit" and skill2_named else "no_special_skill")
        ),
        "specialSkill2RuleId":verified_skill2_spec["ruleId"] if verified_skill2_spec else None,
        "specialSkill2RuleAuthority":verified_skill2_spec["ruleAuthority"] if verified_skill2_spec else None,
        "specialSkill2ExecutionStatus":(
            "source-card-rule-implemented" if verified_skill2_spec else
            ("disabled-until-skill2-rule-review" if typ=="unit" and skill2_named else "no-skill")
        ),
        "specialSkillMappingStatus":(
            source_skill1.get("mappingStatus","no_special_skill") if typ=="unit" and source_skill1 else "no_special_skill"
        ),
        "specialSkillRuleAuthority":(
            source_skill1.get("ruleAuthority") if typ=="unit" and source_skill1 else None
        ),
        "specialSkillRuleIds":[
            m["ruleId"] for m in (row.get("skill_mappings") or [])
            if typ=="unit" and m.get("sourceField")=="Skill1"
            and m.get("mappingStatus")=="manual_verified" and m.get("ruleAuthority")=="manual"
        ],
        "specialSkillRuleId":next((
            m["ruleId"] for m in (row.get("skill_mappings") or [])
            if typ=="unit" and m.get("sourceField")=="Skill1"
            and m.get("mappingStatus")=="manual_verified" and m.get("ruleAuthority")=="manual"
        ),None),
        "specialSkillExecutionStatus":(
            "manual-rule-catalogue-mapped" if typ=="unit" and any(
                m.get("sourceField")=="Skill1" and m.get("mappingStatus")=="manual_verified"
                and m.get("ruleAuthority")=="manual" for m in (row.get("skill_mappings") or [])
            ) else ("metadata-only" if typ!="unit" else "unmapped-or-community-candidate")
        ),
        "effect":None
    }
    if typ=="land":
        lp=integer(f.get("RequireLP"))
        card["requiredLP"]=lp
        card["requiredLPKnown"]=lp is not None
        card["requiredLPStatus"]="source-defined" if lp is not None else "source-missing"
        if lp is not None: add(tabs,"분류별","필요LP",lp)

        land_cost_known=bool(c["known"] and not c.get("mappingReview",False) and not c.get("semanticReview",False))
        card["landInstallCost"]=c["cost"] if land_cost_known else None
        card["landInstallCostKnown"]=land_cost_known
        card["landInstallCostRaw"]=f.get("RequireSoul")
        card["landInstallCostReview"]=c["review"]
        card["landInstallCostReviewStatus"]=c.get("sourceStatus","legacy-enum-parse")
        card["landInstallCostCandidate"]=c.get("candidateCost",{})
        if land_cost_known:
            add(tabs,"분류별","설치 소울 비용",json.dumps(c["cost"],ensure_ascii=False,sort_keys=True))

        earn=parse_earn_soul_list(f.get("EarnSoulList"),earn_soul_enum,f.get("MuSoul"))
        mode="needs-review" if not earn["known"] else ("magicland-effect" if earn["magicLand"] else "source-decoded")
        card["soulProduction"]={"colored":earn["colored"],"neutral":earn["neutral"]}
        card["soulProductionTokens"]=earn["tokens"]
        card["soulProductionStatus"]=mode
        card["soulProductionSource"]="Firestore EarnSoulList + Enum+EarnSoul"
        card["soulProductionRaw"]=f.get("EarnSoulList")
        card["soulProductionReview"]=earn["review"]
        card["isMagicLand"]=earn["magicLand"]
        card["souls"]=list(earn["colored"])
        card["soulValue"]=1
        card["neutralSoulProduction"]=earn["neutral"]
        if mode=="magicland-effect":
            add(tabs,"분류별","지형 유형","매직랜드 · 원문 특수 효과")
        else:
            for soul_color, amount in earn["colored"].items():
                add(tabs,"분류별","생산 소울",f"{soul_color} {amount}")
            add(tabs,"분류별","생산무소울",earn["neutral"])
    elif typ=="unit":
        for src,dst in [("ATK","ap"),("DEF","dp"),("HP","hp")]:
            n=integer(f.get(src))
            if n is not None: card[dst]=n
        card["level"]=integer(f.get("LV"))
        card["sourceCoinTech"]={k:f.get(k) for k in ("ATKCoin","ATKCoinType","ATKCoinCount","DEFCoin","DEFCoinType","DEFCoinCount","HPCoin","HPCoinType","HPCoinCount")}
        ability=label(enums,"UnitType",f.get("UnitType"))
        card["unitAbility"]=ability;add(tabs,"분류별","유닛 능력",ability)
        skills=[skill1_name,skill2_name]
        card["specialSkill"]=" / ".join(s for s in skills if s)
        if card["specialSkill"]: add(tabs,"분류별","특수 공격 기술",card["specialSkill"])
        add(tabs,"분류별","Skill1 원본 기술",skill1_name or "없음")
        add(tabs,"분류별","Skill2 원본 기술",skill2_name or "없음")
        for src,ko in [("ATK","공"),("DEF","방"),("HP","체")]:
            if f.get(src) is not None: tabs["분류별"].append({"label":ko,"text":f"{ko}\n{f[src]}"})
    elif typ=="item":
        ability=label(enums,"UnitType",f.get("UnitType"))
        card["equipAbility"]=ability;card["allowedUnitAbilities"]=[ability] if ability else []
        for src,dst in [("ATK","apBonus"),("DEF","dpBonus"),("HP","hpBonus")]:
            n=integer(f.get(src))
            if n is not None: card[dst]=n
        card["sourceCoinTech"]={k:f.get(k) for k in ("ATKCoin","ATKCoinType","ATKCoinCount","DEFCoin","DEFCoinType","DEFCoinCount","HPCoin","HPCoinType","HPCoinCount")}
        add(tabs,"분류별","장착 능력",ability)
    elif typ in ("spell","enchant"):
        trigger=label(enums,"TurnType",f.get("TurnType"))
        duration_type=label(enums,"DurationType",f.get("DurationType"))
        duration=integer(f.get("Duration"))
        card["triggerTiming"]=trigger;add(tabs,"분류별","발동 시점",trigger)
        if duration is not None:
            card["durationTurns"]=duration;card["durationText"]=str(duration)+(duration_type or "턴")
            add(tabs,"분류별","지속 턴",card["durationText"])
        else: card["durationText"]=duration_type
        if typ=="enchant":
            slot=label(enums,"EnchantSlot",f.get("EnchantSlot"))
            card["slotLocation"]=slot;card["enchantSlotCode"]=f.get("EnchantSlot")
            card["enchantSlotStatus"]="site-enum-decoded" if slot else "source-code-only"
            add(tabs,"분류별","슬롯 위치",slot)

    card["episode"]=label(enums,"Episode",f.get("Episode")) or ""
    card["rarity"]=label(enums,"RareUI",f.get("RareUI")) or label(enums,"RareType",f.get("RareType")) or ""
    card["race"]=label(enums,"RaceType",f.get("RaceType")) or ""
    card["affiliation"]=label(enums,"CompanyType",f.get("CompanyType")) or ""
    card["deckLimit"]=integer(f.get("DeckLimit"))
    card["purchaseRank"]=label(enums,"BuyGrade",f.get("BuyGrade")) or ""
    card["releaseDate"]=str(f.get("ReleaseDate") or "")
    return card

def expected_large_image_name(card):
    # Prefer the exact large-image URL captured from the source page; KIND is only a fallback.
    urls=card.get("sourceImageUrls") or {}
    candidates=urls.values() if isinstance(urls,dict) else urls if isinstance(urls,list) else []
    for value in candidates:
        url=str(value or "").split("?",1)[0]
        lower=url.lower()
        if "/large/" in lower and lower.endswith("l.webp"):
            return url.rsplit("/",1)[-1]
    # Firestore document ID identifies the card page; KIND is the category-scoped art number.
    fields=card.get("sourceFields") or {}
    category=integer(fields.get("Category"))
    kind=integer(fields.get("KIND"))
    prefix=CATEGORY_PREFIX.get(category)
    if not prefix or kind is None or kind<0 or kind>99999:
        raise ValueError(f"Missing valid large image URL or Category/KIND for {card.get('id')}")
    return f"{prefix}{kind:05d}L.webp"

def large_image_card_id(archive_member_name):
    # T stores files under data/images/{small|large}/{FirestoreDocumentId}.webp.
    # The archive is created with -C data/images ., so member paths look like
    # ./large/{documentId}.webp. Match the document ID, not the original
    # Firebase Storage basename (for example M03861L.webp).
    parts = [part for part in PurePosixPath(str(archive_member_name)).parts if part not in ("", ".", "/")]
    if len(parts) < 2 or parts[-2].lower() != "large":
        return None
    filename = parts[-1]
    if not filename.lower().endswith(".webp"):
        return None
    return filename[:-5]


def self_test():
    require_soul_enum={
        "1":{"symbol":"NONE","icon":"/none.webp"},
        "11":{"symbol":"DARK","icon":"/dark.webp"},
        "12":{"symbol":"DARK_EARTH","icon":"/dark_earth.webp"},
        "13":{"symbol":"DARK_FIRE","icon":"/dark_fire.webp"},
        "21":{"symbol":"FIRE","icon":"/fire.webp"},
        "81":{"symbol":"MU","icon":"/mu.webp"},
        "82":{"symbol":"NCS","icon":"/ncs.webp"},
        "83":{"symbol":"BONUS","icon":"/bonus.webp"}
    }
    assert parse_cost("11012102",require_soul_enum)["cost"]=={"dark":1,"fire":2}
    assert parse_cost("12011101",require_soul_enum)["cost"]=={"dark":2,"earth":1}
    assert parse_cost("1302",require_soul_enum)["cost"]=={"dark":2,"fire":2}
    assert parse_cost("8102",require_soul_enum)["cost"]=={"neutral":2}
    assert parse_cost("8301",require_soul_enum)["known"] is False
    assert parse_cost("8201",require_soul_enum)["known"] is False
    assert parse_cost("0100",require_soul_enum)["cost"]=={"neutral":0}
    assert parse_cost("",require_soul_enum)["known"] is False
    assert CATEGORY[5]=="enchant" and sum(EXPECTED.values())==TOTAL
    assert expected_large_image_name({"id":"land-card","sourceFields":{"Category":1,"KIND":5}})=="L00005L.webp"
    assert expected_large_image_name({"id":"magic-card","sourceFields":{"Category":3,"KIND":3861}})=="M03861L.webp"
    assert expected_large_image_name({"id":"enchant-card","sourceFields":{"Category":5,"KIND":823}})=="E00823L.webp"
    assert large_image_card_id("./large/16121533861.webp") == "16121533861"
    assert large_image_card_id("large/M03861L.webp") == "M03861L"
    assert large_image_card_id("./small/16121533861.webp") is None
    assert large_image_card_id("16121533861.webp") is None
    earn_enum={
        "1":{"symbol":"NONE","icon":"/none.webp"},
        "3":{"symbol":"ALL","icon":"/all.webp"},
        "2":{"symbol":"SPELL","icon":"/spell.webp"},
        "11":{"symbol":"DARK","icon":"/dark.webp"},
        "12":{"symbol":"DARK_EARTH","icon":"/dark_earth.webp"},
        "71":{"symbol":"LIGHT","icon":"/light.webp"},
        "81":{"symbol":"MU01","icon":"/mu01.webp"},
        "82":{"symbol":"MU02","icon":"/mu02.webp"}
    }
    all_souls=parse_earn_soul_list("03018201",earn_enum,2)
    assert all_souls["known"] and all_souls["colored"]=={
        "dark":1,"fire":1,"water":1,"forest":1,"metal":1,"earth":1,"light":1
    } and all_souls["neutral"]==2
    hybrid=parse_earn_soul_list("120171018201",earn_enum,2)
    assert hybrid["known"] and hybrid["colored"]=={"dark":1,"earth":1,"light":1} and hybrid["neutral"]==2
    magic=parse_earn_soul_list("0201",earn_enum,0)
    assert magic["known"] and magic["magicLand"] and not magic["colored"] and magic["neutral"]==0
    mismatch=parse_earn_soul_list("8201",earn_enum,1)
    assert not mismatch["known"] and any("cross-check-mismatch" in x for x in mismatch["review"])
    none=parse_earn_soul_list("0100",earn_enum,0)
    assert none["known"] and not none["colored"] and none["neutral"]==0
    magic_many=parse_earn_soul_list("0201",earn_enum,0)
    assert magic_many["known"] and magic_many["magicLand"] is True
    print("converter self-test: PASS")

def verified_skill2_rule_for_card(card_type, skill2_name, text_extra):
    """Return a Skill2 rule only when this exact card carries its rule evidence in TextExtra."""
    if card_type != "unit":
        return None
    spec = SKILL2_SOURCE_VERIFIED_RULES.get(str(skill2_name or ""))
    if not spec:
        return None
    needle = spec.get("cardVerificationNeedle") or spec.get("evidenceNeedle")
    if not needle or needle not in str(text_extra or ""):
        return None
    return spec


SKILL2_SOURCE_VERIFIED_RULES = {
    "기선제압": {
        "ruleId":"skill2_tactical_initiative",
        "ruleAuthority":"card_source",
        "trigger":"before_incoming_damage",
        "mechanic":"방어시 공격 유닛 레벨이 방어 유닛 레벨 이하이면 받는 데미지 1 감소",
        "evidenceNeedle":"데미지를 1 덜 받는다",
    },
    "헌신방어": {
        "ruleId":"skill2_devoted_defense",
        "ruleAuthority":"card_source",
        "trigger":"on_self_destroyed",
        "mechanic":"자신이 파괴되면 아군 필드 다음 유닛의 AP/DP/HP를 각각 1 증가",
        "evidenceNeedle":"아군 필드 다음 유닛 공방체 +1",
    },
    "격노": {
        "ruleId":"skill2_frenzy_defense",
        "ruleAuthority":"card_source",
        "trigger":"after_incoming_damage",
        "mechanic":"방어시 공격을 받아 감소한 HP만큼 자신의 AP 증가",
        "evidenceNeedle":"자신의 HP가 깎인 수치만큼 AP 상승",
    },
    "홀리오오라": {
        "ruleId":"skill2_holy_aura",
        "ruleAuthority":"card_source",
        "trigger":"before_incoming_damage",
        "mechanic":"방어시 공격 유닛 AP가 자신의 DP+HP 합의 절반(내림) 이하이면 받는 데미지 무효",
        "evidenceNeedle":"방/체 합 1/2 이하",
        # The other DB29 card has the same shorthand but omits floor rounding.
        # Only the explicit floor(rounded down) source wording verifies this card.
        "cardVerificationNeedle":"내림",
    },
    "얼라이디펜스": {
        "ruleId":"skill2_alliance_defense",
        "ruleAuthority":"card_source",
        "trigger":"before_incoming_damage",
        "mechanic":"방어 시 자신을 제외한 동일 소속 아군 필드 유닛 수만큼 받는 데미지 감소",
        "evidenceNeedle":"자신과 동일한 소속의 필드 유닛 수 만큼 받는 데미지 감소",
    },
    "레이셜디펜스": {
        "ruleId":"skill2_racial_defense",
        "ruleAuthority":"card_source",
        "trigger":"before_incoming_damage",
        "mechanic":"방어 시 자신을 제외한 동일 종족 아군 필드 유닛 수만큼 받는 데미지 감소",
        "evidenceNeedle":"자신과 동일한 종족의 필드 유닛 수 만큼 받는 데미지 감소",
    },
    "강한헌신방어": {
        "ruleId":"skill2_strong_devoted_defense",
        "ruleAuthority":"card_source",
        "trigger":"on_self_destroyed",
        "mechanic":"자신이 파괴되면 남은 아군 필드 유닛 전체의 AP/DP/HP를 각각 1 증가",
        "evidenceNeedle":"아군 필드 유닛 전체의 공방체가 1증가한다",
    },
    "프레셔": {
        "ruleId":"skill2_pressure_defense",
        "ruleAuthority":"card_source",
        "trigger":"before_incoming_damage",
        "mechanic":"방어 시 아군 필드 빈 슬롯 수의 절반(내림)만큼 받는 데미지 감소",
        "evidenceNeedle":"아군 필드 빈공간수 절반(내림) 만큼 받은 데미지를 감소시킨다",
    },
}


# DB29 card-local TextExtra evidence audit: Holy Aura's only explicit floor
# wording is on an item, while the unit's wording leaves rounding unspecified.
# The item must not activate the unit-only combat defense handler.
DB29_SKILL2_UNIT_EVIDENCE_RULE_IDS = frozenset({
    "skill2_tactical_initiative",
    "skill2_devoted_defense",
    "skill2_frenzy_defense",
    "skill2_alliance_defense",
    "skill2_racial_defense",
    "skill2_strong_devoted_defense",
    "skill2_pressure_defense",
})


def build_skill2_catalogue(mapping_records, cards, release_tag):
    """Build Skill2 inventory; only exact card-source-described rules with tests are executable."""
    card_by_id={str(card.get("id")):card for card in cards}
    grouped={}
    status_counts=Counter()
    active_card_ids=set()
    no_skill_card_ids=set()
    for mapping in mapping_records:
        if mapping.get("sourceField")!="Skill2":
            continue
        enum_value=str(mapping.get("sourceEnumValue") or "")
        source_name=str(mapping.get("sourceName") or "")
        key=(enum_value,source_name)
        entry=grouped.setdefault(key,{
            "sourceField":"Skill2","enumValue":enum_value,"name":source_name,
            "cardIds":[],"sourceMappingStatuses":set(),"sourceCandidateRuleIds":set()
        })
        card_id=str(mapping.get("cardId") or "")
        if card_id: entry["cardIds"].append(card_id)
        status=str(mapping.get("mappingStatus") or "unmapped")
        entry["sourceMappingStatuses"].add(status)
        status_counts[status]+=1
        if status=="no_special_skill" or source_name in ("","없음"):
            if card_id: no_skill_card_ids.add(card_id)
        elif card_id:
            active_card_ids.add(card_id)
        if mapping.get("ruleId"):
            entry["sourceCandidateRuleIds"].add(str(mapping["ruleId"]))

    records=[]
    executable_rules=set()
    for key,entry in sorted(grouped.items(),key=lambda item:(
        int(item[0][0]) if item[0][0].isdigit() else 10**9,item[0][1])):
        card_ids=sorted(set(entry["cardIds"]))
        refs=[]
        for card_id in card_ids:
            card=card_by_id.get(card_id)
            if card is None:
                raise RuntimeError("Skill2 mapping references missing cards.json record: "+card_id)
            refs.append({
                "cardId":card_id,"name":card.get("name"),"cardType":card.get("type"),
                "sourceCardUrl":card.get("sourceCardUrl"),
                "sourceListUrl":card.get("sourceListUrl"),
                "faction":card.get("faction"),"unitAbility":card.get("unitAbility"),
                "level":card.get("level"),"ap":card.get("ap"),"dp":card.get("dp"),"hp":card.get("hp"),
                "skill1":card.get("specialSkill1"),"skill2":card.get("specialSkill2") or "",
                "skill2EnumValue":card.get("specialSkill2EnumValue"),
                "skill2MappingStatus":card.get("specialSkill2MappingStatus"),
                "skill2SourceMappingStatus":card.get("specialSkill2SourceMappingStatus"),
                "skill2RuleId":card.get("specialSkill2RuleId"),
                "skill2RuleAuthority":card.get("specialSkill2RuleAuthority"),
                "skill2ExecutionStatus":card.get("specialSkill2ExecutionStatus"),
                "text":card.get("text") or "",
                "description":card.get("description") or "",
                "effectCandidateCount":card.get("effectCandidateCount",0)
            })
        source_name=entry["name"]
        no_skill=source_name in ("","없음") or entry["sourceMappingStatuses"]=={"no_special_skill"}
        spec=SKILL2_SOURCE_VERIFIED_RULES.get(source_name) if not no_skill else None
        evidence_needle=(spec.get("cardVerificationNeedle") or spec["evidenceNeedle"]) if spec else None
        # Skill2 defensive handlers are unit mechanics. Item descriptions may
        # mention the same label/wording but cannot verify a unit's rule mapping.
        evidence_refs=[
            ref for ref in refs
            if spec and ref.get("cardType")=="unit"
            and evidence_needle in (ref.get("description") or "")
        ]
        if spec and evidence_refs:
            executable_rules.add(spec["ruleId"])
            verification="source_card_verified"
            execution="source-card-rule-implemented"
            rule_id=spec["ruleId"]
            authority=spec["ruleAuthority"]
            evidence_card_ids=[ref["cardId"] for ref in evidence_refs]
            mechanic=spec["mechanic"]
            trigger=spec["trigger"]
        else:
            verification="no_special_skill" if no_skill else "extracted_unverified"
            execution="no-skill" if no_skill else "disabled-until-skill2-rule-review"
            rule_id=None
            authority=None
            evidence_card_ids=[]
            mechanic=None
            trigger=None
        records.append({
            "sourceField":"Skill2","enumValue":entry["enumValue"],"name":source_name,
            "cardCount":len(card_ids),"cardIds":card_ids,"cardReferences":refs,
            "sourceMappingStatuses":sorted(entry["sourceMappingStatuses"]),
            "sourceCandidateRuleIds":sorted(entry["sourceCandidateRuleIds"]),
            "ruleId":rule_id,"ruleAuthority":authority,
            "verificationStatus":verification,"executionStatus":execution,
            "mechanic":mechanic,"trigger":trigger,
            "evidenceSource":"fmlunatic-card-detail-description" if spec else None,
            "evidenceCardIds":evidence_card_ids,
            "evidenceUrl":"https://fmlunatic.com/cardlist" if spec else None
        })
    active_records=[x for x in records if x["verificationStatus"]!="no_special_skill"]
    return {
        "schemaVersion":1,"sourceDatabaseRelease":release_tag,"sourceField":"Skill2",
        "description":"Independent Skill2 enum inventory with per-card source URLs and raw text. The eight executable entries are exact, repeated card-detail descriptions with dedicated engine tests; all other active entries remain disabled until their own effect evidence and tests are reviewed.",
        "mappingRecordCount":sum(status_counts.values()),"entryCount":len(records),
        "activeSkillCount":len(active_records),"activeCardCount":len(active_card_ids),
        "noSkillCardCount":len(no_skill_card_ids),
        "mappingStatusCounts":dict(sorted(status_counts.items())),
        "executableRuleCount":len(executable_rules),
        "executableRuleIds":sorted(executable_rules),
        "records":records
    }

def convert(a):
    skill_catalogue_path=Path(a.skill_catalogue)
    skill_catalogue=json.loads(skill_catalogue_path.read_text(encoding="utf-8"))
    manual_catalogue_rules=skill_catalogue.get("manualRules",[])
    community_catalogue_rules=skill_catalogue.get("communityCandidates",[])
    if skill_catalogue.get("schemaVersion")!=1 or len(manual_catalogue_rules)!=27 or len(community_catalogue_rules)!=41:
        raise RuntimeError("T skill catalogue does not match the audited 27 manual / 41 community candidate baseline")
    skill_catalogue_sha256=hashlib.sha256(skill_catalogue_path.read_bytes()).hexdigest()
    enum_data=json.loads(Path(a.enumtable).read_text(encoding="utf-8"))
    enums=enum_lookup(enum_data)
    earn_soul_enum=enum_symbol_map(enum_data,"EarnSoul")
    require_soul_enum=enum_symbol_map(enum_data,"RequireSoul")
    if not earn_soul_enum:
        raise RuntimeError("enumtable is missing Enum+EarnSoul; refusing to guess land soul production")
    if not require_soul_enum:
        raise RuntimeError("enumtable is missing Enum+RequireSoul; refusing to guess soul payment costs")
    cards=[]
    source_records=load_normalized_database(a.db_sqlite)
    source_db_counts={"cards":len(source_records),"databaseRelease":a.db_release_tag}
    skill_mapping_records=[
        {"cardId":row["card_id"],**mapping}
        for row in source_records for mapping in row.get("skill_mappings",[])
    ]
    skill_db_counts={
        "manualRuleCount":len(manual_catalogue_rules),
        "communityRuleCandidateCount":len(community_catalogue_rules),
        "cardRuleMappingRows":len(skill_mapping_records),
        "manualSkillMappingRows":sum(1 for m in skill_mapping_records if m.get("mappingStatus")=="manual_verified"),
        "communitySkillCandidateRows":sum(1 for m in skill_mapping_records if m.get("mappingStatus")=="community_documented_candidate"),
        "unmappedSkillRows":sum(1 for m in skill_mapping_records if m.get("mappingStatus")=="unmapped"),
        "skillEnumInventoryRows":len({
            (m.get("sourceField"),m.get("sourceEnumValue"),m.get("sourceName"))
            for m in skill_mapping_records
        }),
        "playableCommunityRuleRows":sum(1 for m in community_catalogue_rules if m.get("playableByDefault") is True),
    }
    if (skill_db_counts["manualRuleCount"]!=27 or skill_db_counts["communityRuleCandidateCount"]!=41
        or skill_db_counts["cardRuleMappingRows"]<15000
        or skill_db_counts["manualSkillMappingRows"]<1000
        or skill_db_counts["communitySkillCandidateRows"]<100
        or skill_db_counts["skillEnumInventoryRows"]<100
        or skill_db_counts["playableCommunityRuleRows"]!=0):
        raise RuntimeError("Card-pack skill mapping review failed: "+json.dumps(skill_db_counts,ensure_ascii=False))
    skill_mapping_data={
        "schemaVersion":1,
        "sourceDatabaseRelease":a.db_release_tag,
        "description":"Per-card Skill1/Skill2 source mappings, including original enum values, authority, confidence and evidence. Only manual-verified Skill1 mappings are eligible for the Manual baseline engine.",
        "recordCount":len(skill_mapping_records),
        "records":skill_mapping_records,
    }
    skill_mapping_bytes=json.dumps(skill_mapping_data,ensure_ascii=False,separators=(",",":")).encode("utf-8")
    skill_mapping_sha256=hashlib.sha256(skill_mapping_bytes).hexdigest()
    effect_candidate_records=[
        {"cardId":row["card_id"],**candidate}
        for row in source_records for candidate in row.get("effect_candidates",[])
    ]
    effect_candidate_data={
        "schemaVersion":1,
        "sourceDatabaseRelease":a.db_release_tag,
        "description":"Non-executable effect text pattern candidates and exact source clause spans. These records are references for later manual review and rule-handler implementation, not executable card effects.",
        "candidateCount":len(effect_candidate_records),
        "clauseCount":sum(len(x.get("clauses",[])) for x in effect_candidate_records),
        "records":effect_candidate_records,
    }
    effect_candidate_bytes=json.dumps(effect_candidate_data,ensure_ascii=False,separators=(",",":")).encode("utf-8")
    effect_candidate_sha256=hashlib.sha256(effect_candidate_bytes).hexdigest()
    for index,row in enumerate(source_records,1):
        card=build_card(row,enums,earn_soul_enum,require_soul_enum)
        for image_type in ("small","large"):
            meta=(row.get("source_image_metadata") or {}).get(image_type) or {}
            card.setdefault("sourceImageSha256",{})[image_type]=meta.get("sha256")
        cards.append(card)
        if index%3000==0: print(f"converted {index}/{TOTAL} SQLite cards",flush=True)
    counts=Counter(c["type"] for c in cards)
    if len(cards)!=TOTAL or counts!=EXPECTED: raise RuntimeError(f"Card counts differ: {len(cards)} {dict(counts)}")
    skill2_catalogue=build_skill2_catalogue(skill_mapping_records,cards,a.db_release_tag)
    if len(cards)==TOTAL and (
        skill2_catalogue["entryCount"]!=189 or skill2_catalogue["activeSkillCount"]!=188
        or skill2_catalogue["activeCardCount"]!=1366
        or set(skill2_catalogue["executableRuleIds"])!=DB29_SKILL2_UNIT_EVIDENCE_RULE_IDS
    ):
        raise RuntimeError("DB29 Skill2 inventory/evidence validation failed: "+json.dumps({
            k:skill2_catalogue[k] for k in ("entryCount","activeSkillCount","activeCardCount","executableRuleCount","executableRuleIds","mappingStatusCounts")
        },ensure_ascii=False))
    skill2_catalogue_bytes=json.dumps(skill2_catalogue,ensure_ascii=False,separators=(",",":")).encode("utf-8")
    skill2_catalogue_sha256=hashlib.sha256(skill2_catalogue_bytes).hexdigest()
    ids=[c["id"] for c in cards]
    if len(set(ids))!=TOTAL: raise RuntimeError("Duplicate card IDs")
    out=Path(a.output)
    if out.exists(): shutil.rmtree(out)
    images=out/"images";images.mkdir(parents=True)
    # In T, image paths are data/images/{small|large}/{documentId}.webp.
    # Only the large variant belongs in the Android install pack.
    expected_images={str(card["id"]):card for card in cards}
    if len(expected_images)!=TOTAL:
        raise RuntimeError(f"Image identity map contains {len(expected_images)} records, expected {TOTAL}")
    extracted_ids=set()
    extracted=0
    with tarfile.open(a.images_tar_gz,"r|gz") as tf:
        for member in tf:
            if not member.isfile():
                continue
            card_id=large_image_card_id(member.name)
            card=expected_images.get(card_id) if card_id else None
            if card is None:
                continue
            if card_id in extracted_ids:
                raise RuntimeError("Duplicate large image archive entry: "+member.name)
            src=tf.extractfile(member)
            if src is None:
                raise RuntimeError("Unreadable image: "+member.name)
            target=images/(card_id+".webp")
            with src,target.open("wb") as dst:
                shutil.copyfileobj(src,dst,1024*1024)
            with target.open("rb") as img:
                h=img.read(12)
            if len(h)<12 or h[:4]!=b"RIFF" or h[8:12]!=b"WEBP":
                raise RuntimeError("Invalid WebP: "+member.name)
            card["sourceImageFileName"]=expected_large_image_name(card)
            card["sourceImageArchivePath"]=member.name
            card["storedImageFileName"]=target.name
            card["artImageSha256"]=hashlib.sha256(target.read_bytes()).hexdigest()
            card["artImageSizeBytes"]=target.stat().st_size
            expected_sha=card.get("sourceImageSha256",{}).get("large")
            expected_size=(card.get("sourceImageMetadata",{}).get("large") or {}).get("byteSize")
            if expected_sha and card["artImageSha256"]!=expected_sha:
                raise RuntimeError("Large image SHA-256 differs from T SQLite manifest: "+card_id)
            if expected_size is not None and int(expected_size)!=card["artImageSizeBytes"]:
                raise RuntimeError("Large image byte size differs from T SQLite manifest: "+card_id)
            card["artImageSha256Verified"]=bool(expected_sha)
            extracted_ids.add(card_id)
            extracted+=1
            if extracted%3000==0:
                print(f"extracted {extracted}/{TOTAL} large images",flush=True)
            if extracted==TOTAL:
                break
    if extracted!=TOTAL:
        missing=next((card_id for card_id in expected_images if card_id not in extracted_ids), "unknown")
        raise RuntimeError(f"Large images extracted {extracted}/{TOTAL}; first missing card: {missing}")
    cards_path=out/"cards.json"
    with cards_path.open("w",encoding="utf-8") as dst:
        json.dump(cards,dst,ensure_ascii=False,separators=(",",":"))
    cards_bytes=cards_path.stat().st_size
    if cards_bytes > 128*1024*1024:
        raise RuntimeError(f"cards.json exceeds Android import limit: {cards_bytes} bytes")
    image_bytes=sum(p.stat().st_size for p in images.glob("*.webp"))
    digest=hashlib.sha256(cards_path.read_bytes()).hexdigest()
    known=sum(1 for c in cards if c["type"]!="land" and c["costKnown"])
    needs_review=sum(1 for c in cards if c["type"]!="land" and not c["costKnown"])
    land_cost_known=sum(1 for c in cards if c["type"]=="land" and c["landInstallCostKnown"])
    land_cost_review=sum(1 for c in cards if c["type"]=="land" and not c["landInstallCostKnown"])
    mapping_review_nonland=sum(1 for c in cards if c["type"]!="land" and c.get("costMappingReview"))
    semantic_review_nonland=sum(1 for c in cards if c["type"]!="land" and c.get("costSemanticReview"))
    mapping_review_land=sum(1 for c in cards if c["type"]=="land" and c.get("costMappingReview"))
    semantic_review_land=sum(1 for c in cards if c["type"]=="land" and c.get("costSemanticReview"))
    effect_candidate_count=len(effect_candidate_records)
    effect_clause_count=effect_candidate_data["clauseCount"]
    land_magiclands=sum(1 for c in cards if c["type"]=="land" and c["isMagicLand"])
    land_production_review=sum(1 for c in cards if c["type"]=="land" and c["soulProductionStatus"]=="needs-review")
    land_token_counts=Counter(t.get("symbol") or "UNMAPPED" for c in cards if c["type"]=="land" for t in c["soulProductionTokens"])
    manifest={
        "format":"FM1-CARD-DATA","version":"1.3.0",
        "cardsCount":TOTAL,"imagesCount":TOTAL,"cardsSha256":digest,
        "classification":{"source":"current FMLunatic Firestore Category enum + current five-type reference",
          "types":dict(counts),
          "enchantIsOfficialFifthType":True},
        "source":{"listUrl":"https://fmlunatic.com/cardlist",
          "cardUrlPattern":"https://fmlunatic.com/card/{documentId}",
          "databaseRelease":f"https://github.com/dragonslayers-k/T/releases/tag/{a.db_release_tag}"},
        "sourceDatabase":{"releaseTag":a.db_release_tag,"schema":"T normalized SQLite v2","cardCount":source_db_counts["cards"]},
        "costReview":{
          "knownNonLandCosts":known,"needsReviewNonLandCosts":needs_review,
          "mappingReviewNonLandCosts":mapping_review_nonland,
          "semanticReviewNonLandCosts":semantic_review_nonland,
          "knownLandInstallationSoulCosts":land_cost_known,
          "needsReviewLandInstallationSoulCosts":land_cost_review,
          "mappingReviewLandInstallationCosts":mapping_review_land,
          "semanticReviewLandInstallationCosts":semantic_review_land,
          "nonLandNeedsReviewByType":dict(Counter(c["type"] for c in cards if c["type"]!="land" and not c["costKnown"])),
          "policy":"Only T SQLite rows with soul_known=1, mapping_review=0 and semantic_review=0 are playable costs. Hybrid candidates and NCS/BONUS remain review-required; source RequireSoul is retained."
        },
        "effectReview":{
          "candidateRows":effect_candidate_count,
          "clauseRows":effect_clause_count,
          "candidateFile":"card-effect-candidates.json",
          "candidateFileSha256":effect_candidate_sha256,
          "verificationStatus":"pattern_candidate",
          "executableEffectMappings":0,
          "policy":"Candidate extraction is reference data only. No candidate is treated as an executable game rule."
        },
        "specialSkillReview":{
          **skill_db_counts,
          "catalogueSchemaVersion":skill_catalogue["schemaVersion"],
          "catalogueManualRules":len(manual_catalogue_rules),
          "catalogueCommunityCandidates":len(community_catalogue_rules),
          "catalogueSha256":skill_catalogue_sha256,
          "catalogueEntry":"skill-catalogue.json",
          "cardSkillMappingsEntry":"card-skill-mappings.json",
          "cardSkillMappingsSha256":skill_mapping_sha256,
          "cardSkillMappingRecordCount":len(skill_mapping_records),
          "skill2CatalogueEntry":"skill2-catalogue.json",
          "skill2CatalogueSha256":skill2_catalogue_sha256,
          "skill2EntryCount":skill2_catalogue["entryCount"],
          "skill2ActiveSkillCount":skill2_catalogue["activeSkillCount"],
          "skill2ActiveCardCount":skill2_catalogue["activeCardCount"],
          "skill2ExecutableRuleCount":skill2_catalogue["executableRuleCount"],
          "effectCandidatesEntry":"card-effect-candidates.json",
          "effectCandidatesSha256":effect_candidate_sha256,
          "manualRuleSource":"Manual.zip / specialability.htm",
          "communitySource":"2017 Inven community reference",
          "communityRulesExecutable":False,
          "executionPolicy":"Manual-verified Skill1 mappings remain eligible for Manual-baseline handlers. Skill2 uses a separate allowlist: only exact card-source descriptions with dedicated engine tests are executable; all other Skill2 community candidates and unmapped values remain reference-only."
        },
        "landSoulProduction":{
          "source":"Firestore EarnSoulList + Enum+EarnSoul",
          "decodedStandardLands":sum(1 for c in cards if c["type"]=="land" and c["soulProductionStatus"]=="source-decoded"),
          "magicLandSpecialEffectLands":land_magiclands,
          "needsReview":land_production_review,
          "tokenCounts":dict(land_token_counts),
          "policy":"Pure and compound color symbols are decoded from the site's EarnSoul enum; ALL yields one of each seven colored souls per token; MU01/MU02/MU03 yield 1/2/3 neutral souls per token; SPELL marks a MagicLand effect and is not a normal soul."
        },
        "images":{"format":"webp","variant":"large","onePerCard":True}
    }
    (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    shutil.copy2(skill_catalogue_path,out/"skill-catalogue.json")
    (out/"card-skill-mappings.json").write_bytes(skill_mapping_bytes)
    (out/"card-effect-candidates.json").write_bytes(effect_candidate_bytes)
    (out/"skill2-catalogue.json").write_bytes(skill2_catalogue_bytes)
    unpacked_bytes=(cards_bytes+image_bytes+(out/"manifest.json").stat().st_size
                    +(out/"skill-catalogue.json").stat().st_size
                    +(out/"card-skill-mappings.json").stat().st_size
                    +(out/"card-effect-candidates.json").stat().st_size
                    +(out/"skill2-catalogue.json").stat().st_size)
    if unpacked_bytes > 700*1024*1024:
        raise RuntimeError(f"FM1-CARD-DATA exceeds Android 700MB unpack limit: {unpacked_bytes} bytes")
    manifest["unpackedBytes"]=unpacked_bytes
    (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    z=Path(a.zip_output);z.parent.mkdir(parents=True,exist_ok=True)
    if z.exists():z.unlink()
    with zipfile.ZipFile(z,"w",allowZip64=True) as archive:
        # Store the large canonical JSON payload without a DEFLATE stream. This avoids
        # platform-specific inflater failures ("invalid stored block lengths") on Android;
        # images are already stored, and cards.json remains SHA-256 verified after import.
        archive.write(cards_path,"cards.json",compress_type=zipfile.ZIP_STORED)
        archive.write(out/"manifest.json","manifest.json",compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
        archive.write(out/"skill-catalogue.json","skill-catalogue.json",compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
        archive.write(out/"card-skill-mappings.json","card-skill-mappings.json",compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
        archive.write(out/"card-effect-candidates.json","card-effect-candidates.json",compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
        archive.write(out/"skill2-catalogue.json","skill2-catalogue.json",compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
        for img in sorted(images.glob("*.webp")):
            archive.write(img,"images/"+img.name,compress_type=zipfile.ZIP_STORED)
    with zipfile.ZipFile(z) as archive:
        if archive.testzip() is not None: raise RuntimeError("Generated ZIP CRC test failed")
        names=archive.namelist()
        if ("cards.json" not in names or "manifest.json" not in names or
            "skill-catalogue.json" not in names or "card-skill-mappings.json" not in names or
            "card-effect-candidates.json" not in names or "skill2-catalogue.json" not in names
            or sum(n.startswith("images/") for n in names)!=TOTAL):
            raise RuntimeError("Generated ZIP structure incomplete")
    print(json.dumps({"zip":str(z),"bytes":z.stat().st_size,"cards":TOTAL,"images":TOTAL,
      "types":dict(counts),"cardsSha256":digest,"cardsJsonBytes":cards_bytes,"imageBytes":image_bytes,
      "unpackedBytes":unpacked_bytes,"costKnownNonLand":known,"costNeedsReviewNonLand":needs_review,
      "mappingReviewNonLand":mapping_review_nonland,"semanticReviewNonLand":semantic_review_nonland,
      "landInstallCostKnown":land_cost_known,"landInstallCostNeedsReview":land_cost_review,
      "mappingReviewLandInstallCost":mapping_review_land,"semanticReviewLandInstallCost":semantic_review_land,
      "effectCandidateRows":effect_candidate_count,"effectClauseRows":effect_clause_count,
      "specialSkillReview":skill_db_counts,
      "cardSkillMappingFileBytes":len(skill_mapping_bytes),
      "cardSkillMappingSha256":skill_mapping_sha256,
      "effectCandidateFileBytes":len(effect_candidate_bytes),
      "effectCandidateFileSha256":effect_candidate_sha256,
      "magicLandCount":land_magiclands,"landSoulProductionNeedsReview":land_production_review,
      "format":manifest["format"],"version":manifest["version"]},ensure_ascii=False,indent=2))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--db-sqlite",help="Audited normalized T SQLite database (uncompressed)")
    p.add_argument("--db-release-tag",default="fm1-carddb-29")
    p.add_argument("--skill-catalogue",help="Source-versioned Manual/community skill catalogue from the same T release")
    p.add_argument("--enumtable");p.add_argument("--images-tar-gz")
    p.add_argument("--output");p.add_argument("--zip-output");p.add_argument("--self-test",action="store_true")
    a=p.parse_args()
    if a.self_test: self_test();return
    if not all([a.db_sqlite,a.skill_catalogue,a.enumtable,a.images_tar_gz,a.output,a.zip_output]):
        p.error("requires --db-sqlite --db-release-tag --skill-catalogue --enumtable --images-tar-gz --output --zip-output")
    convert(a)
if __name__=="__main__": main()
