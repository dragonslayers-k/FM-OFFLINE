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
        code, amount = token[:2], int(token[2:])
        meta = earn_enum.get(code)
        if not meta:
            out["review"].append("unresolved-earn-soul-code:" + token)
            out["tokens"].append({"raw":token,"code":int(code),"amount":amount,"status":"unmapped"})
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

def build_card(row, enums, earn_soul_enum):
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
        "costSource":("firestore-requiresoul-land-install" if c["known"] else "unresolved-firestore-requiresoul-land-install") if typ=="land" else ("firestore-requiresoul-enum" if cost_known else "unresolved-firestore-requiresoul"),
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
        card["requiredLPKnown"]=lp is not None
        card["requiredLPStatus"]="source-defined" if lp is not None else "source-missing"
        if lp is not None: add(tabs,"분류별","필요LP",lp)

        land_cost_known=bool(c["known"])
        card["landInstallCost"]=c["cost"] if land_cost_known else None
        card["landInstallCostKnown"]=land_cost_known
        card["landInstallCostRaw"]=f.get("RequireSoul")
        card["landInstallCostReview"]=c["review"]
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
    assert parse_cost("11012102")["cost"]=={"dark":1,"fire":2}
    assert parse_cost("8301")["known"] is False
    assert parse_cost("0100")["cost"]=={"neutral":0}
    assert parse_cost("")["known"] is False
    assert CATEGORY[5]=="enchant" and sum(EXPECTED.values())==TOTAL
    assert expected_large_image_name({"id":"land-card","sourceFields":{"Category":1,"KIND":5}})=="L00005L.webp"
    assert expected_large_image_name({"id":"magic-card","sourceFields":{"Category":3,"KIND":3861}})=="M03861L.webp"
    assert expected_large_image_name({"id":"enchant-card","sourceFields":{"Category":5,"KIND":823}})=="E00823L.webp"
    assert large_image_card_id("./large/16121533861.webp") == "16121533861"
    assert large_image_card_id("large/M03861L.webp") == "M03861L"
    assert large_image_card_id("./small/16121533861.webp") is None
    assert large_image_card_id("16121533861.webp") is None
    earn_enum={
        "03":{"symbol":"ALL","icon":"/all.webp"},
        "02":{"symbol":"SPELL","icon":"/spell.webp"},
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
    print("converter self-test: PASS")

def convert(a):
    enum_data=json.loads(Path(a.enumtable).read_text(encoding="utf-8"))
    enums=enum_lookup(enum_data)
    earn_soul_enum=enum_symbol_map(enum_data,"EarnSoul")
    if not earn_soul_enum:
        raise RuntimeError("enumtable is missing Enum+EarnSoul; refusing to guess land soul production")
    cards=[]
    with gzip.open(a.cards_jsonl_gz,"rt",encoding="utf-8") as src:
        for lineno,line in enumerate(src,1):
            if line.strip(): cards.append(build_card(json.loads(line),enums,earn_soul_enum))
            if lineno%3000==0: print(f"converted {lineno} source lines",flush=True)
    counts=Counter(c["type"] for c in cards)
    if len(cards)!=TOTAL or counts!=EXPECTED: raise RuntimeError(f"Card counts differ: {len(cards)} {dict(counts)}")
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
    land_magiclands=sum(1 for c in cards if c["type"]=="land" and c["isMagicLand"])
    land_production_review=sum(1 for c in cards if c["type"]=="land" and c["soulProductionStatus"]=="needs-review")
    land_token_counts=Counter(t["symbol"] for c in cards if c["type"]=="land" for t in c["soulProductionTokens"])
    manifest={
        "format":"FM1-CARD-DATA","version":"1.1.1",
        "cardsCount":TOTAL,"imagesCount":TOTAL,"cardsSha256":digest,
        "classification":{"source":"current FMLunatic Firestore Category enum + current five-type reference",
          "types":{"land":289,"unit":8633,"spell":3857,"item":1748,"enchant":823},
          "enchantIsOfficialFifthType":True},
        "source":{"listUrl":"https://fmlunatic.com/cardlist",
          "cardUrlPattern":"https://fmlunatic.com/card/{documentId}",
          "databaseRelease":"https://github.com/dragonslayers-k/T/releases/tag/fm1-carddb-25"},
        "costReview":{
          "knownNonLandCosts":known,"needsReviewNonLandCosts":needs_review,
          "knownLandInstallationSoulCosts":land_cost_known,
          "needsReviewLandInstallationSoulCosts":land_cost_review,
          "policy":"LP and RequireSoul are separate land installation requirements. Unknown mixed/NCS/BONUS tokens are never treated as free."
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
      "unpackedBytes":unpacked_bytes,"costKnownNonLand":known,"costNeedsReviewNonLand":needs_review,
      "landInstallCostKnown":land_cost_known,"landInstallCostNeedsReview":land_cost_review,
      "magicLandCount":land_magiclands,"landSoulProductionNeedsReview":land_production_review,
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
