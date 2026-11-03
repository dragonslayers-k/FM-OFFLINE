(function (root) {
  'use strict';

  const COLORS = ['dark','fire','water','forest','metal','earth','light','neutral'];
  const TYPE_NAMES = { land:'지형', unit:'유닛', item:'아이템', spell:'마법', enchant:'인챈트' };
  const META_LABELS = {
    '분류':'category','속성':'faction','에피소드':'episode','덱 수량제한':'deckLimit',
    '희귀도':'rarity','종족타입':'race','소속타입':'affiliation','기타타입':'otherType',
    '구매등급':'purchaseRank','발매일':'releaseDate'
  };
  function htmlToText(value) {
    return String(value || '').replace(/<\s*br\s*\/?>/gi,'\n').replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi,'\n')
      .replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&')
      .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
      .replace(/[ \t\f\v]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  function dedupeTextBlocks(blocks) {
    const unique = [];
    for (const block of blocks || []) {
      const text = htmlToText(typeof block === 'string' ? block : block && block.text);
      const key = text.normalize('NFKC').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
      if (!key) continue;
      const compactKey=key.replace(/[\s\p{P}\p{S}]+/gu,'');
      const duplicate = unique.find(item => {
        const itemCompact=item.key.replace(/[\s\p{P}\p{S}]+/gu,'');
        return item.key===key || itemCompact===compactKey ||
          (Math.min(itemCompact.length,compactKey.length)>=12 &&
            (itemCompact.includes(compactKey)||compactKey.includes(itemCompact)));
      });
      if (duplicate) {
        if (key.length > duplicate.key.length) {
          duplicate.key = key;
          duplicate.text = text;
        }
        continue;
      }
      unique.push({label:String((block && block.label) || ''),text,key});
    }
    return unique.map(({label,text}) => ({label,text}));
  }
  function textOf(item) {
    if (typeof item === 'string') return htmlToText(item);
    if (!item || typeof item !== 'object') return '';
    return htmlToText((typeof item.text === 'string' && item.text) || item.html || item.value || '');
  }
  function entries(card, group) {
    const raw = card && card.tabs && card.tabs[group];
    return Array.isArray(raw) ? raw.map(textOf).filter(Boolean) : [];
  }
  function parsePair(line) {
    const m = String(line || '').match(/^\s*([^：:\n]{1,40})\s*[：:]\s*([\s\S]*)$/);
    return m ? [m[1].trim(),m[2].trim()] : null;
  }
  function fieldMap(card, group) {
    const result = Object.create(null);
    const lines = entries(card, group);
    if (card && card.description) lines.push(...htmlToText(card.description).split(/\r?\n/));
    for (const line of lines) {
      const pair = parsePair(line);
      if (pair && !Object.prototype.hasOwnProperty.call(result,pair[0])) result[pair[0]]=pair[1];
    }
    return result;
  }
  function integer(value) {
    if (value === undefined || value === null || value === '') return null;
    const m=String(value).replace(/,/g,'').match(/-?\d+/); return m?Number(m[0]):null;
  }
  function decimal(value) {
    if (value === undefined || value === null || value === '') return null;
    const m=String(value).replace(/,/g,'').match(/-?\d+(?:\.\d+)?/); return m?Number(m[0]):null;
  }
  function parseColors(value) {
    const source=Array.isArray(value)?value.join(' '):String(value||'');
    const found=COLORS.filter(c=>source.toLowerCase().includes(c));
    const ko={'암흑':'dark','어둠':'dark','불':'fire','화염':'fire','물':'water','바다':'water','숲':'forest','자연':'forest','금속':'metal','대지':'earth','땅':'earth','빛':'light','광명':'light','무속성':'neutral','무':'neutral'};
    for(const [label,color] of Object.entries(ko)) if(source.includes(label)&&!found.includes(color)) found.push(color);
    return [...new Set(found)];
  }
  function normalizeCostObject(value) {
    if(!value||typeof value!=='object'||Array.isArray(value)) return null;
    const out={}; for(const [color,amount] of Object.entries(value)){
      if(!COLORS.includes(color)||!Number.isInteger(Number(amount))||Number(amount)<0) return null;
      out[color]=Number(amount);
    } return out;
  }
  function parseSoulProduction(raw,detail,meta) {
    const out={colored:{},neutral:0}, src=raw&&raw.soulProduction;
    if(src&&typeof src==='object'){
      const colors=src.colored&&typeof src.colored==='object'?src.colored:src;
      for(const [color,value] of Object.entries(colors)) if(color!=='neutral'&&COLORS.includes(color)&&decimal(value)!==null&&decimal(value)>=0) out.colored[color]=decimal(value);
      const neutral=decimal(src.neutral??raw.neutralSoulProduction);
      if(neutral!==null&&neutral>=0) out.neutral=neutral;
      if(Object.keys(out.colored).length||out.neutral>0||
          ['source-decoded','magicland-effect'].includes(raw.soulProductionStatus)) return out;
    }
    const labels={dark:['생산암흑소울','생산어둠소울'],fire:['생산불소울','생산화염소울'],water:['생산물소울','생산수소울'],forest:['생산숲소울'],metal:['생산금속소울'],earth:['생산대지소울','생산땅소울'],light:['생산빛소울','생산광명소울']};
    let explicit=false;
    for(const [color,keys] of Object.entries(labels)){
      const key=keys.find(k=>detail&&detail[k]!==undefined&&detail[k]!=='');
      if(key){const n=decimal(detail[key]);if(n!==null&&n>=0){out.colored[color]=n;explicit=true;}}
    }
    if(!explicit){
      const colors=parseColors(Array.isArray(raw.souls)&&raw.souls.length?raw.souls:(raw.faction||raw.attribute||(meta&&meta['속성']))).filter(c=>c!=='neutral');
      const amount=decimal(raw.soulValue)??1; for(const color of colors) out.colored[color]=amount;
    }
    const neutral=decimal(raw.neutralSoulProduction??detail['생산무소울']??detail['생산무속성소울']);
    out.neutral=neutral!==null&&neutral>=0?neutral:0; return out;
  }
  function normalizeAbility(value) {
    const aliases={
      '魔法':'마법','마법계':'마법','마법능력':'마법','마법 유닛':'마법',
      '야수계':'야수','야수능력':'야수','야수 유닛':'야수',
      '장비계':'장비','장비능력':'장비','장비 유닛':'장비',
      'universal':'만능','all':'만능','무관':'만능','제한없음':'만능','모든유닛':'만능'
    };
    return [...new Set(String(value||'').split(/[\/,·＋+]/).map(v=>v.trim()).filter(Boolean).map(v=>aliases[v]||v))];
  }
  function parseCardTextEffect(cardText) {
    const raw=String(cardText||'').trim(), text=raw.replace(/\s+/g,'');
    if(!text||/수만큼|각각|무작위|랜덤|레벨에맞게|교체|복제|유지턴|조건부|~일때|마다/.test(text)) return null;
    const slotTarget=text.match(/(아군|자신|적군|상대(?:방)?|적)(?:필드)?유닛(\d+)?/);
    if(slotTarget){
      const target=/^(아군|자신)$/.test(slotTarget[1])?'ownUnit':'enemyUnit';
      const slotIndex=slotTarget[2]?Number(slotTarget[2]):null;
      const statMatch=text.match(/((?:AP|DP|HP)(?:\/(?:AP|DP|HP))*)(?:를|이|은)?([+-]?\d+)(?:만큼|씩)?(증가|상승|감소|하락)/);
      if(statMatch){
        const delta=Number(statMatch[2])*((statMatch[3]==='감소'||statMatch[3]==='하락')?-1:1);
        const effect={type:'buff',target,slotIndex,ap:0,dp:0,hp:0,sourceText:raw,mapping:'slot-stat-text'};
        statMatch[1].split('/').forEach(stat=>{effect[stat.toLowerCase()]=delta;});
        return effect;
      }
    }
    let m;
    m=text.match(/(?:적군|상대(?:방)?|적)(?:필드)?(?:유닛)?(?:의)?(?:HP)?(?:에게|에)?(\d+)(?:의)?(?:HP)?(?:데미지|피해)/);
    if(m)return {type:'damage',target:'enemyUnit',amount:Number(m[1]),sourceText:raw,mapping:'simple-text'};
    m=text.match(/(?:아군|자신)(?:필드)?(?:유닛)?(?:의)?(?:HP)?(?:를)?(\d+)(?:만큼)?(?:회복|증가)/);
    if(m)return {type:'heal',target:'ownUnit',amount:Number(m[1]),sourceText:raw,mapping:'simple-text'};
    m=text.match(/(?:상대|적군|적)(?:의)?덱(?:카드)?(\d+)장(?:을)?파괴/);
    if(m)return {type:'mill',target:'enemyDeck',amount:Number(m[1]),sourceText:raw,mapping:'simple-text'};
    m=text.match(/(?:카드|덱에서)(\d+)장(?:을)?(?:드로우|뽑)/);
    if(m)return {type:'draw',target:'ownDeck',amount:Number(m[1]),sourceText:raw,mapping:'simple-text'};
    m=text.match(/(?:상대|적군|적)(?:의)?HP(?:를)?(\d+)(?:만큼)?흡수/);
    if(m)return {type:'drain',target:'enemyUnit',amount:Number(m[1]),sourceText:raw,mapping:'simple-text'};
    for(const stat of ['AP','DP','HP']){
      const key=stat.toLowerCase();
      m=text.match(new RegExp('(?:아군|자신)(?:필드)?(?:유닛)?(?:의)?'+stat+'(?:를)?\\+(\\d+)(?:만큼)?(?:증가|상승)'));
      if(m)return {type:'buff',target:'ownUnit',ap:key==='ap'?Number(m[1]):0,dp:key==='dp'?Number(m[1]):0,hp:key==='hp'?Number(m[1]):0,sourceText:raw,mapping:'simple-text'};
      m=text.match(new RegExp('(?:적군|상대|적)(?:필드)?(?:유닛)?(?:의)?'+stat+'(?:를)?-(\\d+)(?:만큼)?(?:감소|하락)'));
      if(m)return {type:'buff',target:'enemyUnit',ap:key==='ap'?-Number(m[1]):0,dp:key==='dp'?-Number(m[1]):0,hp:key==='hp'?-Number(m[1]):0,sourceText:raw,mapping:'simple-text'};
    }
    return null;
  }
  function mappedType(value) {
    const s = String(value || '').trim();
    const types = {'지형':'land','유닛':'unit','마법':'spell','아이템':'item','인챈트':'enchant'};
    return types[s] || (TYPE_NAMES[s] ? s : null);
  }
  function parseCoinExpression(value) {
    const raw=String(value||'').trim().replace(/\s+/g,'').toUpperCase();
    const match=raw.match(/^([+\-X]?)(\d*)C(\d+)$/);
    if(!match)return null;
    const op=match[1];
    return {source:raw,operation:op==='-'?'subtract':op==='X'?'multiply':op==='+'?'add':'set',
      multiplier:match[2]?Number(match[2]):1,tosses:Number(match[3])};
  }
  function parseStatTech(card) {
    const lines = entries(card,'분류별');
    const block = lines.find(x => /(^|\n)\s*(공|방|체)\s*(\n|$)/.test(x)) || '';
    const parts = String(block).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const labels = {공:'ap',방:'dp',체:'hp'};
    const result = {};
    let current = null;
    for (const part of parts) {
      if (labels[part]) {
        current = labels[part];
        if (!result[current]) result[current] = { value: null, marker: '', coin: [] };
        continue;
      }
      if (!current) continue;
      const coin = parseCoinExpression(part);
      if (coin) {
        result[current].coin.push(coin);
        continue;
      }
      const valueMatch = part.match(/^([▲▼△▽★*]?)(-?\d+(?:\.\d+)?)$/);
      if (valueMatch && result[current].value === null) {
        result[current].marker = valueMatch[1] || '';
        result[current].value = Number(valueMatch[2]);
      }
    }
    const tosses = Object.values(result).flatMap(x => x.coin).reduce((m,x) => Math.max(m,x.tosses),0);
    return { stats:result, sharedTosses:tosses, raw:block };
  }
  function normalizeTabs(rawTabs) {
    const output = {};
    for (const [group,items] of Object.entries(rawTabs || {})) {
      output[group] = Array.isArray(items) ? items.map(item => ({
        text:textOf(item),
        html:item && typeof item === 'object' && typeof item.html === 'string' ? item.html : ''
      })) : [];
    }
    return output;
  }

  function parseItemConditions(cardText) {
    const text=htmlToText(cardText||'');
    const hasEnemy=/적군/.test(text),hasOwn=/아군/.test(text);
    const c={owner:hasEnemy!==hasOwn?(hasEnemy?'enemy':'own'):null,race:null,affiliation:null,
      universal:/만능|모든\s*(?:유닛|종족)|아무\s*유닛|제한\s*없음|무관/.test(text),unsupported:[]};
    const race=text.match(/([가-힣A-Za-z0-9_-]+)\s*종족\s*유닛/), aff=text.match(/([가-힣A-Za-z0-9_-]+)\s*소속\s*유닛/);
    if(race)c.race=race[1]; if(aff)c.affiliation=aff[1];
    if(/종족/.test(text)&&!c.race)c.unsupported.push('race');
    if(/소속/.test(text)&&!c.affiliation)c.unsupported.push('affiliation');
    if(/장착\s*시/.test(text)&&/아군|적군/.test(text)&&!c.race&&!c.affiliation&&!c.universal)c.unsupported.push('target');
    c.requiresTargetCheck=!!(c.owner||c.race||c.affiliation||c.unsupported.length);
    c.mapped=c.unsupported.length===0; return c;
  }
  function normalize(raw) {
    if(!raw||typeof raw!=='object') throw new TypeError('FM1 card record must be an object');
    const detail=fieldMap(raw,'분류별'),meta=fieldMap(raw,'기타'),textFields=fieldMap(raw,'텍스트');
    const type=mappedType(raw.type||meta['분류']||raw.category);
    const attribute=raw.faction||raw.attribute||meta['속성']||'neutral';
    const colors=parseColors(Array.isArray(raw.souls)&&raw.souls.length?raw.souls:attribute).filter(c=>c!=='neutral');
    const faction=COLORS.includes(raw.faction)?raw.faction:(colors[0]||'neutral');
    const statTech=parseStatTech(raw);
    const cardText=htmlToText(raw.text||detail['카드 텍스트']||detail['카드텍스트']||textFields['카드 텍스트']||'');
    const n={...raw,id:String(raw.id||''),name:String(raw.name||''),type:type||raw.type,faction,rawType:raw.type||null,
      text:htmlToText(raw.text||''),race:raw.race||meta['종족타입']||'',affiliation:raw.affiliation||meta['소속타입']||'',
      rarity:raw.rarity||meta['희귀도']||'',episode:raw.episode||meta['에피소드']||'',
      deckLimitText:raw.deckLimitText||meta['덱 수량제한']||'',deckLimit:integer(raw.deckLimit??meta['덱 수량제한']),
      purchaseRank:meta['구매등급']||'',releaseDate:meta['발매일']||'',sourceDescription:htmlToText(raw.description||''),
      sourceTabs:normalizeTabs(raw.tabs),statTech,statMarkers:Object.fromEntries(['ap','dp','hp'].map(s=>[s,statTech.stats[s]?.marker||''])),
      rules:{source:'FM1-CardData-v1.0.1',status:'description-only',classification:detail,metadata:meta,text:textFields,cardText,unsupportedReason:''}};
    const primaryCost=normalizeCostObject(raw.cost);
    const verifiedImageCost=normalizeCostObject(root.FM_VERIFIED_COSTS&&root.FM_VERIFIED_COSTS[String(raw.id)]);
    const hasPrimaryCost=primaryCost!==null&&Object.keys(primaryCost).length>0;
    const sourceCost=hasPrimaryCost?primaryCost:(verifiedImageCost!==null?verifiedImageCost:normalizeCostObject(raw.soulCost));
    const costKnown=verifiedImageCost!==null||(raw.costKnown!==false&&sourceCost!==null&&Object.keys(sourceCost).length>0);
    n.cost=costKnown?sourceCost:null;n.costKnown=costKnown;n.costMapped=costKnown;
    n.costSource=hasPrimaryCost?'source-json':(verifiedImageCost!==null?'verified-image-map':(sourceCost?'source-soulCost':'unknown'));
    const landCandidates=[raw.landInstallCost,raw.installCost,raw.summonCost,raw.soulCost,type==='land'?raw.cost:null]
      .map(normalizeCostObject).filter(value=>value!==null&&Object.keys(value).length>0);
    const landObj=landCandidates[0]||null;
    const landKnown=raw.landInstallCostKnown===true&&landObj!==null;
    n.landInstallCost=landKnown?landObj:null;n.landInstallCostKnown=landKnown;
    n.landInstallCostReview=Array.isArray(raw.landInstallCostReview)?raw.landInstallCostReview:[];
    if(type==='land'){
      const prod=parseSoulProduction(raw,detail,meta);n.soulProduction=prod;n.souls=Object.keys(prod.colored).filter(c=>Number(prod.colored[c])>0);
      const amounts=Object.values(prod.colored).map(Number);
      n.soulValue=amounts.length&&amounts.every(v=>v===amounts[0])?amounts[0]:(decimal(raw.soulValue)??1);
      n.neutralSoulProduction=prod.neutral;
      const sourceLP=integer(raw.requiredLP??detail['필요LP']);
      n.requiredLP=sourceLP;
      n.requiredLPKnown=raw.requiredLPKnown===true&&sourceLP!==null;
      n.rules.requiredLPStatus=n.requiredLPKnown?'source-defined':'source-missing';
      const total=Object.values(prod.colored).reduce((s,v)=>s+Number(v||0),0)+prod.neutral;
      n.rules.costStatus=n.requiredLPKnown&&n.landInstallCostKnown?'mapped':'installation-cost-needs-review';
      if(raw.soulProductionStatus==='magicland-effect'){
        n.rules.status='special-effect-pending';
        n.rules.unsupportedReason='매직랜드의 소울 코스트 발동 효과는 원문을 보존했으며, 별도 실행 규칙 구현 전까지 임의 생산/발동을 하지 않습니다.';
      }else if(raw.soulProductionStatus!=='source-decoded'){
        n.rules.status='incomplete';
        n.rules.unsupportedReason='지형의 EarnSoulList 생산 토큰이 검증되지 않았습니다.';
      }else if(total>0){
        n.rules.status='mapped';
      }else{
        n.rules.status='incomplete';
        n.rules.unsupportedReason='표준 지형의 소울 생산량이 0입니다.';
      }
    }else if(type==='unit'){
      n.unitAbility=htmlToText(raw.unitAbility||raw.unitType||raw.abilityType||detail['유닛 능력']||detail['유닛 능력 타입']||'');n.unitAbilityTags=normalizeAbility(n.unitAbility);
      n.rank=raw.rank||detail['랭크']||'';
      n.skill=htmlToText(raw.specialSkill||raw.specialAbility||raw.attackSkill||raw.skill||detail['특수공격기술']||detail['특수 공격 기술']||detail['공격기술']||detail['특수 능력']||detail['특수능력']||detail['스킬']||detail['공격 능력']||'');
      // Preserve the two source enum fields independently. Skill2 has its own
      // catalogue and must never inherit Skill1's Manual attack handler.
      n.specialSkill1=htmlToText(raw.specialSkill1||'');
      n.specialSkill2=htmlToText(raw.specialSkill2||'');
      n.specialSkill1EnumValue=raw.specialSkill1EnumValue==null?null:String(raw.specialSkill1EnumValue);
      n.specialSkill2EnumValue=raw.specialSkill2EnumValue==null?null:String(raw.specialSkill2EnumValue);
      n.specialSkill2MappingStatus=String(raw.specialSkill2MappingStatus||
        (n.specialSkill2&&n.specialSkill2!=='없음'?'unmapped':'no_special_skill'));
      n.specialSkill2RuleId=null;
      n.specialSkill2ExecutionStatus=n.specialSkill2&&n.specialSkill2!=='없음'
        ?'disabled-until-skill2-rule-review':'no-skill';
      // Compact card metadata carries only the playable decision. Full per-card
      // Skill1/Skill2 provenance lives in card-skill-mappings.json and the source SQLite DB.
      n.specialSkillMappings=Array.isArray(raw.specialSkillMappings)?raw.specialSkillMappings:[];
      n.specialSkillMappingStatus=String(raw.specialSkillMappingStatus||'');
      n.specialSkillRuleAuthority=raw.specialSkillRuleAuthority||null;
      const compactManual=raw.specialSkillMappingStatus==='manual_verified'&&
        raw.specialSkillRuleAuthority==='manual'&&
        typeof raw.specialSkillRuleId==='string'&&raw.specialSkillRuleId.length>0;
      const legacyManual=n.specialSkillMappings.find(x=>
        x&&x.sourceField==='Skill1'&&x.mappingStatus==='manual_verified'&&
        x.ruleAuthority==='manual'&&typeof x.ruleId==='string'&&x.ruleId.length>0
      );
      n.specialSkillRuleId=compactManual?raw.specialSkillRuleId:(legacyManual?legacyManual.ruleId:null);
      n.specialSkillExecutionStatus=compactManual||legacyManual?'manual-rule-catalogue-mapped':
        (raw.specialSkillMappingStatus==='community_documented_candidate'||
         n.specialSkillMappings.some(x=>x&&x.mappingStatus==='community_documented_candidate')
          ?'community-candidate-not-executable':'unmapped-or-no-skill');
      n.coinTech=statTech;n.ap=raw.ap!==undefined&&raw.ap!==null&&raw.ap!==''&&Number.isFinite(Number(raw.ap))?Number(raw.ap):statTech.stats.ap?.value;
      n.dp=raw.dp!==undefined&&raw.dp!==null&&raw.dp!==''&&Number.isFinite(Number(raw.dp))?Number(raw.dp):statTech.stats.dp?.value;
      n.hp=raw.hp!==undefined&&raw.hp!==null&&raw.hp!==''&&Number.isFinite(Number(raw.hp))?Number(raw.hp):statTech.stats.hp?.value;
      n.level=Number.isFinite(Number(raw.level))?Number(raw.level):integer(meta['레벨']||detail['레벨']);
      n.rules.status=Number.isFinite(Number(n.ap))&&Number.isFinite(Number(n.dp))&&Number.isFinite(Number(n.hp))&&Number(n.hp)>0?'mapped':'incomplete';
      if(n.rules.status==='incomplete')n.rules.unsupportedReason='유닛 AP·DP·HP 정보가 불완전합니다.';
    }else if(type==='item'){
      const hasField=Object.prototype.hasOwnProperty.call(detail,'장착 능력')||raw.equipAbility!==undefined||raw.allowedUnitAbilities!==undefined;
      const rawAbility=raw.equipAbility??raw.unitAbility??detail['장착 능력'];
      let allowed=normalizeAbility(raw.allowedUnitAbilities??rawAbility);
      if(!allowed.length&&hasField&&!String(rawAbility||'').trim())allowed=['만능'];
      n.equipAbility=String(rawAbility||(allowed.includes('만능')?'만능':''));n.allowedUnitAbilities=allowed;
      n.skill=htmlToText(raw.specialSkill||raw.specialAbility||raw.attackSkill||raw.skill||detail['특수공격기술']||detail['특수 공격 기술']||detail['공격기술']||detail['특수 능력']||detail['특수능력']||detail['스킬']||'');
      n.specialSkillMappings=Array.isArray(raw.specialSkillMappings)?raw.specialSkillMappings:[];
      n.specialSkillRuleId=null;n.specialSkillExecutionStatus='metadata-only';
      n.coinDeltaText=detail['코인 증감']||'';
      n.coinProbabilityText=detail['코인 확률']||'';n.coinTech=statTech;
      n.apBonus=Number.isFinite(Number(raw.apBonus))?Number(raw.apBonus):Number(statTech.stats.ap?.value||0);
      n.dpBonus=Number.isFinite(Number(raw.dpBonus))?Number(raw.dpBonus):Number(statTech.stats.dp?.value||0);
      n.hpBonus=Number.isFinite(Number(raw.hpBonus))?Number(raw.hpBonus):Number(statTech.stats.hp?.value||0);
      const conditionText=[cardText,detail['장착 조건'],detail['장착 대상']].filter(Boolean).join('\n');
      n.itemConditions=parseItemConditions(conditionText);n.itemConditions.universal=n.itemConditions.universal||allowed.includes('만능');
      n.itemConditions.mapped=!!(n.itemConditions.mapped&&(allowed.length>0||n.itemConditions.universal||n.itemConditions.owner||n.itemConditions.race||n.itemConditions.affiliation));
      n.rules.cardText=cardText;n.rules.itemConditions=n.itemConditions;
      const hasEquipRule=allowed.length>0||n.itemConditions.universal||n.itemConditions.owner||n.itemConditions.race||n.itemConditions.affiliation;
      n.rules.status=!hasEquipRule?'incomplete':!n.itemConditions.mapped?'unmapped':'condition-text';
      if(n.rules.status==='incomplete')n.rules.unsupportedReason='아이템 장착 가능 유닛 능력 조건이 없습니다.';
      else if(n.rules.status==='unmapped')n.rules.unsupportedReason='아이템의 종족·소속 장착 조건을 원문에서 완전히 해석하지 못했습니다.';
      if(n.skill&&n.skill!=='없음')n.grantsSpecialSkill=n.skill;
    }else if(type==='spell'||type==='enchant'){
      n.triggerTiming=detail['발동 시점']||detail['발동시점']||meta['발동 시점']||'';
      n.durationText=detail['지속 턴']||detail['지속턴']||'';n.durationTurns=integer(n.durationText);
      n.rules.cardText=cardText;
      n.effectCandidates=Array.isArray(raw.effectCandidates)?raw.effectCandidates:[];
      const candidateOnly=raw.effectExecutionStatus==='candidate-only'||
        raw.effectVerificationStatus==='pattern_candidate'||
        n.effectCandidates.some(x=>x&&x.verificationStatus==='pattern_candidate');
      n.effectExecutionStatus=candidateOnly?'candidate-only':(raw.effectExecutionStatus||'unmapped');
      n.effectVerificationStatus=candidateOnly?'pattern_candidate':
        (raw.effectVerificationStatus||((raw.effectVerified===true)?'verified':'unmapped'));
      n.effect=candidateOnly?null:(raw.effectVerified===true?raw.effect:(raw.effect||parseCardTextEffect(cardText)));
      n.rules.effectStatus=candidateOnly?'pattern_candidate':(n.effect?'simple-text-mapped':'unmapped-text-effect');
      if(type==='enchant'){
        n.slotLocation=detail['슬롯 위치']||detail['슬롯위치']||'';
        const sm=String(n.slotLocation).match(/슬롯\s*(\d+)/);n.slotIndex=sm?Number(sm[1]):null;
        n.slotOwner=/적군/.test(n.slotLocation)?'enemy':/아군/.test(n.slotLocation)?'own':null;
        n.rules.status=n.slotLocation?'condition-text':'incomplete';
        if(!n.slotLocation)n.rules.unsupportedReason='인챈트 슬롯 위치 조건이 없습니다.';
      }else{
        n.rules.status=n.effect?'simple-effect-mapped':'text-effect-only';
        if(!n.effect)n.rules.unsupportedReason='원본 설명은 보존했으나 효과 실행 규칙으로 매핑되지 않았습니다.';
      }
    }else{n.rules.status='incomplete';n.rules.unsupportedReason='원본 카드 종류를 판별하지 못했습니다.';}
    if(type!=='land')n.rules.costStatus=costKnown?'mapped':'missing-from-card-image';
    return n;
  }

  function normalizeMany(records) {
    if (!Array.isArray(records)) throw new TypeError('FM1 card data must be an array');
    const ids = new Set();
    return records.map(record => {
      const card = normalize(record);
      if (!card.id || ids.has(card.id)) throw new Error('Missing or duplicate FM1 card ID: ' + card.id);
      ids.add(card.id);
      return card;
    });
  }
  const api = {normalize,normalizeMany,fieldMap,entries,normalizeAbility,mappedType,parseStatTech,parseCoinExpression,parseItemConditions,parseCardTextEffect,htmlToText,dedupeTextBlocks,parseColors,parseSoulProduction};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FMCardSchema = api;
})(typeof window !== 'undefined' ? window : globalThis);
