#!/usr/bin/env python3
"""Convert FM Lunatic Firestore release data into the Android app's FM1-CARD-DATA ZIP."""
import argparse, gzip, hashlib, json, os, shutil, tarfile, zipfile
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

def parse_cost(raw):
    # RequireSoul is a concatenation of 4-char tokens: 2-char type + 2-char count.
    out={"cost":{},"known":False,"review":[],"raw":raw}
    if not isinstance(raw,str) or not raw:
        out["review"].append("source-cost-missing"); return out
    if len(raw)%4:
        out["review"].append("invalid-token-width"); return out
    values={}
    for i in range(0,len(raw),4):
        token=raw[i:i+4]
        if not token.isdigit():
            out["review"].append("non-numeric-token:"+token); continue
        code,amount=int(token[:2]),int(token[2:])
        if code in PURE_SOUL:
            color=PURE_SOUL[code]; values[color]=values.get(color,0)+amount
        elif code==1 and amount==0:
            values.setdefault("neutral",0)
        else:
            out["review"].append("unresolved-soul-code:"+token)
    if not out["review"] and values:
        out["cost"]=values;out["known"]=True
    elif not out["review"]:
        out["review"].append("no-recognized-cost-token")
    return out

def add(tabs, group, label_text, value):
    if value is None or value=="": return
    tabs.setdefault(group,[]).append({"label":label_text,"text":f"{label_text} : {value}"})

def build_card(row, enums):
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

    c=parse_cost(f.get("RequireSoul"))
    cost_known=(c["known"] and typ!="land")
    card={
        "id":cid,"name":name,"type":typ,"faction":color,
        "cost":c["cost"] if cost_known else {},
        "costKnown":cost_known,"costMapped":cost_known,
        "costSource":"not-applicable-lp-land-placement" if typ=="land" else ("firestore-requiresoul-enum" if cost_known else "unresolved-firestore-requiresoul"),
        "soulCostRaw":f.get("RequireSoul"),"costReview":c["review"],
        "text":base,"description":extra,"tabs":tabs,
        "artImage":cid+".webp",
        "sourceCardUrl":row.get("source_card_url") or f"https://fmlunatic.com/card/{cid}",
        "sourceListUrl":row.get("source_list_url") or "https://fmlunatic.com/cardlist",
        "sourceImageUrls":row.get("source_image_urls") or {},
        "sourceFields":f,"sourceCollectedAt":row.get("collected_at"),
        "sourceDocumentId":cid
    }
    if typ=="land":
        lp=integer(f.get("RequireLP"))
        card["requiredLP"]=lp
        card["requiredLPStatus"]="source-defined" if lp is not None else "source-missing"
        if lp is not None: add(tabs,"분류별","필요LP",lp)
        colored={color:1} if color!="neutral" else {}
        mu=integer(f.get("MuSoul")); neutral=mu if mu is not None and mu>=0 else 0
        card.update({"souls":list(colored),"soulValue":1,"neutralSoulProduction":neutral,
                     "soulProduction":{"colored":colored,"neutral":neutral},
                     "soulProductionSource":"SoulType+MuSoul",
                     "soulProductionReview":"EarnSoulList preserved in sourceFields; verify any multi-colour production"})
        add(tabs,"분류별","생산무소울",neutral)
    elif typ=="unit":
        for src,dst in [("ATK","ap"),("DEF","dp"),("HP","hp")]:
            n=integer(f.get(src))
            if n is not None: card[dst]=n
        card["level"]=integer(f.get("LV"))
        card["sourceCoinTech"]={k:f.get(k) for k in ("ATKCoin","ATKCoinType","ATKCoinCount","DEFCoin","DEFCoinType","DEFCoinCount","HPCoin","HPCoinType","HPCoinCount")}
        ability=label(enums,"UnitType",f.get("UnitType"))
        card["unitAbility"]=ability;add(tabs,"분류별","유닛 능력",ability)
        skills=[label(enums,k,f.get(k)) for k in ("Skill1","Skill2")]
        card["specialSkill"]=" / ".join(s for s in skills if s)
        if card["specialSkill"]: add(tabs,"분류별","특수 공격 기술",card["specialSkill"])
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

def self_test():
    assert parse_cost("11012102")["cost"]=={"dark":1,"fire":2}
    assert parse_cost("8301")["known"] is False
    assert parse_cost("0100")["cost"]=={"neutral":0}
    assert parse_cost("")["known"] is False
    assert CATEGORY[5]=="enchant" and sum(EXPECTED.values())==TOTAL
    assert expected_large_image_name({"id":"land-card","sourceFields":{"Category":1,"KIND":5}})=="L00005L.webp"
    assert expected_large_image_name({"id":"magic-card","sourceFields":{"Category":3,"KIND":3861}})=="M03861L.webp"
    assert expected_large_image_name({"id":"enchant-card","sourceFields":{"Category":5,"KIND":823}})=="E00823L.webp"
    print("converter self-test: PASS")

def convert(a):
    enums=enum_lookup(json.loads(Path(a.enumtable).read_text(encoding="utf-8")))
    cards=[]
    with gzip.open(a.cards_jsonl_gz,"rt",encoding="utf-8") as src:
        for lineno,line in enumerate(src,1):
            if line.strip(): cards.append(build_card(json.loads(line),enums))
            if lineno%3000==0: print(f"converted {lineno} source lines",flush=True)
    counts=Counter(c["type"] for c in cards)
    if len(cards)!=TOTAL or counts!=EXPECTED: raise RuntimeError(f"Card counts differ: {len(cards)} {dict(counts)}")
    ids=[c["id"] for c in cards]
    if len(set(ids))!=TOTAL: raise RuntimeError("Duplicate card IDs")
    out=Path(a.output)
    if out.exists(): shutil.rmtree(out)
    images=out/"images";images.mkdir(parents=True)
    # KIND is the per-category image number; Firestore document ID is a different identity.
    expected_images={}
    for card in cards:
        filename=expected_large_image_name(card)
        if filename in expected_images:
            raise RuntimeError(f"Duplicate category/KIND image identity: {filename}")
        expected_images[filename]=card
    if len(expected_images)!=TOTAL:
        raise RuntimeError(f"Image identity map contains {len(expected_images)} records, expected {TOTAL}")
    extracted=0
    with tarfile.open(a.images_tar_gz,"r|gz") as tf:
        for member in tf:
            if not member.isfile():
                continue
            filename=PurePosixPath(member.name).name
            card=expected_images.get(filename)
            if card is None:
                continue
            src=tf.extractfile(member)
            if src is None:
                raise RuntimeError("Unreadable image: "+filename)
            target=images/(card["id"]+".webp")
            with src,target.open("wb") as dst:
                shutil.copyfileobj(src,dst,1024*1024)
            with target.open("rb") as img:
                h=img.read(12)
            if len(h)<12 or h[:4]!=b"RIFF" or h[8:12]!=b"WEBP":
                raise RuntimeError("Invalid WebP: "+filename)
            card["sourceImageFileName"]=filename
            card["artImageSha256"]=hashlib.sha256(target.read_bytes()).hexdigest()
            card["artImageSizeBytes"]=target.stat().st_size
            extracted+=1
            if extracted%3000==0:
                print(f"extracted {extracted}/{TOTAL} large images",flush=True)
            if extracted==TOTAL:
                break
    if extracted!=TOTAL:
        present={p.stem for p in images.glob("*.webp")}
        missing=next((expected_images[name]["id"] for name in expected_images
                      if expected_images[name]["id"] not in present), "unknown")
        raise RuntimeError(f"Large images extracted {extracted}/{TOTAL}; first missing card: {missing}")
    cards_path=out/"cards.json"
    with cards_path.open("w",encoding="utf-8") as dst:
        json.dump(cards,dst,ensure_ascii=False,separators=(",",":"))
    cards_bytes=cards_path.stat().st_size
    if cards_bytes > 128*1024*1024:
        raise RuntimeError(f"cards.json exceeds Android import limit: {cards_bytes} bytes")
    image_bytes=sum(p.stat().st_size for p in images.glob("*.webp"))
    digest=hashlib.sha256(cards_path.read_bytes()).hexdigest()
    known=sum(1 for c in cards if c["costKnown"])
    not_applicable=sum(1 for c in cards if c["type"]=="land")
    needs_review=sum(1 for c in cards if c["type"]!="land" and not c["costKnown"])
    manifest={
        "format":"FM1-CARD-DATA","version":"1.1.0",
        "cardsCount":TOTAL,"imagesCount":TOTAL,"cardsSha256":digest,
        "classification":{"source":"current FMLunatic Firestore Category enum + current five-type reference",
          "types":{"land":289,"unit":8633,"spell":3857,"item":1748,"enchant":823},
          "enchantIsOfficialFifthType":True},
        "source":{"listUrl":"https://fmlunatic.com/cardlist",
          "cardUrlPattern":"https://fmlunatic.com/card/{documentId}",
          "databaseRelease":"https://github.com/dragonslayers-k/T/releases/tag/fm1-carddb-25"},
        "costReview":{"knownFromUnambiguousFirestoreTokens":known,"needsReview":needs_review,"notApplicableLandPlacement":not_applicable,
          "policy":"Land placement uses LP, not a soul install cost. Unknown, mixed, NCS and BONUS tokens are not treated as free."},
        "images":{"format":"webp","variant":"large","onePerCard":True}
    }
    (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    unpacked_bytes=cards_bytes+image_bytes+(out/"manifest.json").stat().st_size
    if unpacked_bytes > 700*1024*1024:
        raise RuntimeError(f"FM1-CARD-DATA exceeds Android 700MB unpack limit: {unpacked_bytes} bytes")
    manifest["unpackedBytes"]=unpacked_bytes
    (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    z=Path(a.zip_output);z.parent.mkdir(parents=True,exist_ok=True)
    if z.exists():z.unlink()
    with zipfile.ZipFile(z,"w",allowZip64=True) as archive:
        archive.write(cards_path,"cards.json",compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
        archive.write(out/"manifest.json","manifest.json",compress_type=zipfile.ZIP_DEFLATED,compresslevel=6)
        for img in sorted(images.glob("*.webp")):
            archive.write(img,"images/"+img.name,compress_type=zipfile.ZIP_STORED)
    with zipfile.ZipFile(z) as archive:
        if archive.testzip() is not None: raise RuntimeError("Generated ZIP CRC test failed")
        names=archive.namelist()
        if "cards.json" not in names or "manifest.json" not in names or sum(n.startswith("images/") for n in names)!=TOTAL:
            raise RuntimeError("Generated ZIP structure incomplete")
    print(json.dumps({"zip":str(z),"bytes":z.stat().st_size,"cards":TOTAL,"images":TOTAL,
      "types":dict(counts),"cardsSha256":digest,"cardsJsonBytes":cards_bytes,"imageBytes":image_bytes,
      "unpackedBytes":unpacked_bytes,"costKnown":known,"costNeedsReview":needs_review,"costNotApplicableLand":not_applicable,
      "format":manifest["format"],"version":manifest["version"]},ensure_ascii=False,indent=2))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--cards-jsonl-gz");p.add_argument("--enumtable");p.add_argument("--images-tar-gz")
    p.add_argument("--output");p.add_argument("--zip-output");p.add_argument("--self-test",action="store_true")
    a=p.parse_args()
    if a.self_test: self_test();return
    if not all([a.cards_jsonl_gz,a.enumtable,a.images_tar_gz,a.output,a.zip_output]):
        p.error("requires --cards-jsonl-gz --enumtable --images-tar-gz --output --zip-output")
    convert(a)
if __name__=="__main__": main()
