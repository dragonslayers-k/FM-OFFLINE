#!/usr/bin/env python3
"""Inventory FM1 Enchant source text. Keyword tags are NOT interpreted execution rules."""
import argparse, csv, json, re, sys
from collections import Counter
from pathlib import Path

EXPECTED = 823
PATTERNS = {
 "stat_change": r"(?:AP|DP|HP|공체|공방|능력치|공격치|방어치|체력치).{0,24}(?:증가|감소|상승|하락|변경|영구|절반|두배)|(?:증가|감소|상승|하락).{0,18}(?:AP|DP|HP|공체|공방)",
 "damage": r"(?:데미지|피해|HP\s*감소|체력\s*감소)",
 "soul_lp_resource": r"(?:소울|유소울|무소울|NCS|LP|지형|유지비)",
 "status_or_skill": r"(?:상태|기술|공격기술|방어기술|부여|기선제압|라이즈업|행동불능)",
 "zone_or_card_move": r"(?:핸드|필드|백필드|소각장|덱|슬롯|이동|복사|소환|생성|파괴|삭제|소각|교체|장착)",
 "conditional": r"(?:이면|아니면|경우|조건|수만큼|이상|이하|같으면|없으면|존재하면|때)",
 "turn_or_trigger": r"(?:공격턴|방어턴|다음턴|발동시|발동 후|유지턴|유지 턴|턴간|영구히|영구)",
 "card_identity_condition": r"(?:속성|소속|종족|타입|레벨|이름|카드가)",
}
RX = {k: re.compile(v, re.I) for k, v in PATTERNS.items()}
REQUIRED = {"Category","EnchantSlot","Duration","DurationType","TurnType","TextBase"}

def clean(value):
 return re.sub(r"\s+"," ",str(value or "")).strip()

def audit(cards, expected=EXPECTED):
 enchants=[c for c in cards if c.get("type")=="enchant"]
 ids=[str(c.get("id") or "") for c in enchants]
 duplicate=[k for k,v in Counter(ids).items() if v>1]
 missing=Counter(); tags=Counter(); slots=Counter(); timings=Counter(); durations=Counter(); texts=set(); rows=[]
 for c in enchants:
  src=c.get("sourceFields") if isinstance(c.get("sourceFields"),dict) else {}
  base=clean(c.get("text") or src.get("TextBase")); extra=clean(c.get("description") or src.get("TextExtra"))
  for field in REQUIRED:
   if field not in src or src.get(field) in (None,""): missing[field]+=1
  if not c.get("sourceCardUrl"): missing["sourceCardUrl"]+=1
  if not c.get("sourceImageUrls"): missing["sourceImageUrls"]+=1
  slot=clean(c.get("slotLocation")); timing=clean(c.get("triggerTiming")); duration=c.get("durationTurns")
  slots[slot or "MISSING"]+=1; timings[timing or "MISSING"]+=1
  durations[str(duration) if duration is not None else "MISSING"]+=1; texts.add(base)
  found=[k for k,rx in RX.items() if rx.search(base+" "+extra)]; tags.update(found)
  rows.append({"id":str(c.get("id") or ""),"name":clean(c.get("name")),"sourceCardUrl":clean(c.get("sourceCardUrl")),
   "slotLocation":slot,"triggerTiming":timing,"durationTurns":"" if duration is None else duration,
   "durationText":clean(c.get("durationText")),"EnchantSlotCode":clean(src.get("EnchantSlot")),
   "keywordTags":";".join(found),"TextBase":base,"TextExtra":extra})
 summary={"scope":"FM1 Enchant inventory; keyword tags are indicators only, not effect semantics",
  "expectedEnchantCards":expected,"actualEnchantCards":len(enchants),"uniqueEnchantIds":len(set(ids)),
  "duplicateIds":duplicate,"uniqueTextBaseCount":len(texts),"missingRequiredFields":dict(missing),
  "slotLocationCounts":dict(slots),"triggerTimingCounts":dict(timings),"durationTurnsCounts":dict(durations),
  "keywordTagCardCounts":dict(tags),"executionRuleMapping":"not yet implemented; per-card text must be reviewed",
  "auditPass":len(enchants)==expected and len(set(ids))==expected and not duplicate and not missing}
 return summary,rows

def self_test():
 sample=[{"id":"e1","type":"enchant","name":"sample","sourceCardUrl":"url","sourceImageUrls":{"large":"url"},
  "slotLocation":"아군 슬롯1","triggerTiming":"공격","durationTurns":2,"durationText":"2NUM",
  "text":"슬롯 유닛의 AP/HP를 2 증가시키고 다음턴 생성 무소울을 1 증가.",
  "sourceFields":{"Category":5,"EnchantSlot":11,"Duration":2,"DurationType":"NUM","TurnType":"ATTACK","TextBase":"원문"}}]
 s,r=audit(sample,1)
 assert s["auditPass"] and "stat_change" in r[0]["keywordTags"] and "soul_lp_resource" in r[0]["keywordTags"]
 print("enchant audit self-test: PASS")

def main():
 p=argparse.ArgumentParser();p.add_argument("--cards-json");p.add_argument("--summary");p.add_argument("--csv");p.add_argument("--self-test",action="store_true");a=p.parse_args()
 if a.self_test: self_test();return
 if not a.cards_json or not a.summary or not a.csv:p.error("requires --cards-json --summary --csv")
 cards=json.loads(Path(a.cards_json).read_text(encoding="utf-8"));summary,rows=audit(cards)
 Path(a.summary).write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
 with Path(a.csv).open("w",encoding="utf-8-sig",newline="") as f:
  writer=csv.DictWriter(f,fieldnames=list(rows[0]) if rows else ["id"]);writer.writeheader();writer.writerows(rows)
 print(json.dumps(summary,ensure_ascii=False,indent=2));sys.exit(0 if summary["auditPass"] else 2)
if __name__=="__main__":main()
