#!/usr/bin/env python3
"""Diagnostic-only source-field audit. Does not modify card data."""
import gzip, json, sys
from collections import Counter, defaultdict
from pathlib import Path

cards_path, enum_path = map(Path, sys.argv[1:3])
enum = json.loads(enum_path.read_text(encoding="utf-8"))
def rows_of(value):
    return value if isinstance(value, list) else list(value.values()) if isinstance(value, dict) else []
def row_code_label(row):
    if isinstance(row, list) and len(row) >= 2:
        return str(row[0]), str(row[2] if len(row) > 2 and row[2] not in (None, "") else row[1])
    if isinstance(row, dict):
        code = row.get("KIND", row.get("value", row.get("ID")))
        if code is not None:
            return str(code), str(row.get("UIName") or row.get("TYPE") or row.get("name") or "")
    return None, None

print("=== ENUM GROUP INVENTORY ===")
for key in sorted(k for k in enum if k.startswith(("Enum+", "Column+"))):
    print(f"{key}: {len(rows_of(enum[key]))} entries")

for group in ("RequireSoul", "EarnSoul", "SoulType", "MuSoul", "Category", "EnchantSlot"):
    key = "Enum+" + group
    if key not in enum:
        print(f"ENUM {key}: NOT PRESENT")
        continue
    values = []
    for row in rows_of(enum[key]):
        code, label = row_code_label(row)
        if code is not None:
            values.append({"code": code, "label": label, "raw": row})
    print("ENUM " + key + ": " + json.dumps(values, ensure_ascii=False, separators=(",", ":")))

type_names = {1:"land",2:"unit",3:"spell",4:"item",5:"enchant"}
category_counts = Counter()
earn_patterns = Counter()
earn_tokens = Counter()
token_samples = defaultdict(list)
land_samples = []
cost_unknown_by_type = Counter()
cost_known_by_type = Counter()
land_ids = 0
bad_earn = []
with gzip.open(cards_path, "rt", encoding="utf-8") as src:
    for line in src:
        if not line.strip():
            continue
        row = json.loads(line)
        f = row.get("raw_payload") or {}
        cat = int(f.get("Category") or 0)
        typ = type_names.get(cat, "unknown")
        category_counts[typ] += 1
        raw_cost = f.get("RequireSoul")
        review = False
        if isinstance(raw_cost, str) and raw_cost and len(raw_cost) % 4 == 0:
            for i in range(0, len(raw_cost), 4):
                token = raw_cost[i:i+4]
                if not token.isdigit() or int(token[:2]) not in {1,11,21,31,41,51,61,71,81}:
                    review = True
        else:
            review = True
        (cost_unknown_by_type if review else cost_known_by_type)[typ] += 1
        if typ != "land":
            continue
        land_ids += 1
        earn = str(f.get("EarnSoulList") or "")
        earn_patterns[earn] += 1
        if len(earn) % 4:
            bad_earn.append({"id":row.get("card_id"),"name":row.get("name"),"raw":earn})
        else:
            for i in range(0, len(earn), 4):
                token = earn[i:i+4]
                code = token[:2]
                earn_tokens[code] += 1
                if len(token_samples[code]) < 4:
                    token_samples[code].append({
                        "id":row.get("card_id"),"name":row.get("name"),
                        "SoulType":f.get("SoulType"),"MuSoul":f.get("MuSoul"),
                        "RequireLP":f.get("RequireLP"),"RequireSoul":raw_cost,
                        "EarnSoulList":earn
                    })
        if len(land_samples) < 8:
            land_samples.append({
                "id":row.get("card_id"),"name":row.get("name"),
                "SoulType":f.get("SoulType"),"MuSoul":f.get("MuSoul"),
                "RequireLP":f.get("RequireLP"),"RequireSoul":raw_cost,
                "EarnSoulList":earn
            })

print("=== SOURCE COUNTS ===")
print(json.dumps({
    "categoryCounts":dict(category_counts),
    "costParsedByCategory":dict(cost_known_by_type),
    "costReviewByCategory":dict(cost_unknown_by_type),
    "landRecords":land_ids,
    "landEarnSoulListMissing":sum(not str(x.get("EarnSoulList") or "") for x in land_samples),
    "landEarnSoulListMalformed":bad_earn[:20]
}, ensure_ascii=False, indent=2))
print("=== EARN SOUL TOKEN FREQUENCY ===")
print(json.dumps({
    "uniquePatterns":len(earn_patterns),
    "topPatterns":earn_patterns.most_common(100),
    "tokenCounts":earn_tokens.most_common(),
    "tokenSamples":dict(token_samples)
}, ensure_ascii=False, indent=2))
print("=== LAND EXAMPLES ===")
print(json.dumps(land_samples, ensure_ascii=False, indent=2))
