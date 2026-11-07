(function (root) {
  'use strict';

  const COLORS = ['dark','fire','water','forest','metal','earth','light','neutral'];
  const COST_KEYS = [...COLORS,'bonus'];
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
      if(!COST_KEYS.includes(color)||!Number.isInteger(Number(amount))||Number(amount)<0) return null;
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
    const match=raw.match(/^([+\-X=]?)(\d*)C(\d+)$/);
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
    const sourceStatTech=card.sourceStatTech&&typeof card.sourceStatTech==='object'?card.sourceStatTech:{};
    for(const stat of ['ap','dp','hp']){
      const source=sourceStatTech[stat];
      if(!source||typeof source!=='object')continue;
      const previous=result[stat]||{value:null,marker:'',coin:[]};
      const typeCode=integer(source.typeCode);
      let marker=previous.marker||'';
      if(typeCode===1)marker='';
      else if([11,12,13].includes(typeCode))marker=String(source.marker||'');
      else if(typeCode!==null)marker='';
      result[stat]={
        ...previous,
        value:decimal(source.value)??previous.value,
        marker,
        sourceTypeCode:typeCode,
        sourceType:String(source.type||''),
        sourceTypeStatus:String(source.status||'source_type_unverified')
      };
    }
    const tosses = Object.values(result).flatMap(x => x.coin).reduce((m,x) => Math.max(m,x.tosses),0);
    return { stats:result, sharedTosses:tosses, raw:block };
  }
  function parseSourceCoinTech(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return {status:'missing',stats:{},sharedTosses:0,review:[]};
    }
    // Firestore CoinType raw values: 1 NONE, 2 PLUS, 3 MINUS, 4 X, 5 EQUAL.
    const operations={2:'add',3:'subtract',4:'multiply',5:'set'};
    const specs=[
      {stat:'ap',value:'ATKCoin',type:'ATKCoinType',count:'ATKCoinCount'},
      {stat:'dp',value:'DEFCoin',type:'DEFCoinType',count:'DEFCoinCount'},
      {stat:'hp',value:'HPCoin',type:'HPCoinType',count:'HPCoinCount'}
    ];
    const stats={},review=[];
    let sharedTosses=0,hasExpression=false;
    for(const spec of specs){
      const rawValue=String(source[spec.value]??'').trim();
      const rawCount=integer(source[spec.count]);
      const rawType=source[spec.type]===undefined||source[spec.type]===null||source[spec.type]===''
        ?null:integer(source[spec.type]);
      if(!rawValue||/^NONE$/i.test(rawValue)){
        if(rawCount!==null&&rawCount>0)review.push(spec.stat+':coin-count-without-expression');
        stats[spec.stat]={coin:[]};
        continue;
      }
      hasExpression=true;
      const parsed=parseCoinExpression(rawValue);
      if(!parsed){
        review.push(spec.stat+':unparsed-expression');
        stats[spec.stat]={coin:[]};
        continue;
      }
      let operation=null;
      if(rawType!==null){
        operation=operations[rawType]||null;
        if(rawType===1){
          review.push(spec.stat+':NONE-type-with-coin-expression');
          stats[spec.stat]={coin:[]};
          continue;
        }
      }else if(/^[+\-X=]/i.test(rawValue)){
        operation=parsed.operation;
      }else{
        review.push(spec.stat+':missing-coin-type');
        stats[spec.stat]={coin:[]};
        continue;
      }
      if(!operation){
        review.push(spec.stat+':unknown-coin-type');
        stats[spec.stat]={coin:[]};
        continue;
      }
      if(rawCount!==null&&rawCount!==parsed.tosses){
        review.push(spec.stat+':coin-count-mismatch');
        stats[spec.stat]={coin:[]};
        continue;
      }
      parsed.operation=operation;
      stats[spec.stat]={coin:[parsed]};
      sharedTosses=Math.max(sharedTosses,parsed.tosses);
    }
    return {status:review.length?'source_review':(hasExpression?'source_mapped':'no_coin'),
      stats,sharedTosses,review};
  }

  function mergeSourceCoinTech(parsed,source) {
    if(!source||!['source_mapped','no_coin'].includes(source.status))return parsed;
    const stats={...(parsed.stats||{})};
    for(const stat of ['ap','dp','hp']){
      const previous=stats[stat]||{value:null,marker:'',coin:[]};
      stats[stat]={...previous,coin:(source.stats[stat]&&source.stats[stat].coin)||[]};
    }
    return {...parsed,stats,sharedTosses:source.sharedTosses,source:'firestore-source-coin-fields'};
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
  function parseRequireSoulRuntime(rawValue, cardType) {
    if (typeof rawValue !== 'string' || !rawValue.length) return null;
    const candidate={}, runtime={}, inference=[];
    let blocked=false, muCrosswalk=false, upkeep=0;
    const pure={'11':'dark','21':'fire','31':'water','41':'forest','51':'iron','61':'earth','71':'light'};
    const hybrid={
      '12':'dark+earth','13':'dark+fire','14':'dark+light','15':'dark+water',
      '22':'fire+forest','23':'fire+iron','24':'fire+water','32':'earth+water',
      '33':'forest+water','42':'forest+iron','43':'forest+light',
      '52':'earth+iron','53':'iron+light','62':'earth+light'
    };
    const add=(target,key,value)=>{target[key]=(target[key]||0)+value;};
    const digits=[...rawValue].every(ch=>ch>='0'&&ch<='9');
    if(!digits||rawValue.length%4!==0){
      return {candidateCost:{unknown:rawValue},runtimeCost:null,runtimeCostKnown:false,
        runtimeCostStatus:'semantic_review_blocked',
        runtimeCostInference:['invalid-requiresoul-source-blocked'],
        runtimeUpkeepCost:{neutral:0},runtimeUpkeepNeutral:0,runtimeUpkeepStatus:'zero_upkeep'};
    }
    for(let i=0;i<rawValue.length;i+=4){
      const code=rawValue.slice(i,i+2),amount=Number(rawValue.slice(i+2,i+4));
      if(amount===0)continue;
      if(pure[code]){
        const color=pure[code];add(candidate,color,amount);add(runtime,color==='iron'?'metal':color,amount);
      }else if(code==='81'){
        add(candidate,'neutral',amount);add(runtime,'neutral',amount);
        muCrosswalk=true;inference.push('mu_81_manual_neutral_bead_crosswalk_inferred');
        if(cardType==='unit')upkeep+=amount;
      }else if(code==='82'){
        add(candidate,'ncs',amount);
        inference.push('ncs_requiresoul_semantics_unverified_blocked');blocked=true;
      }else if(code==='83'){
        add(candidate,'bonus',amount);
        inference.push('bonus_requiresoul_semantics_unverified_blocked');blocked=true;
      }else if(hybrid[code]){
        add(candidate,'hybrid:'+hybrid[code],amount);
        inference.push('hybrid_payment_semantics_unverified_blocked');blocked=true;
      }else if(code==='01'){
        add(candidate,'unknown:'+code,amount);
        inference.push('nonzero-none-requiresoul-token-blocked');blocked=true;
      }else{
        add(candidate,'unknown:'+code,amount);
        inference.push('unknown_requiresoul_token_blocked');blocked=true;
      }
    }
    if(!Object.keys(candidate).length&&!blocked)runtime.neutral=0;
    return {
      candidateCost:candidate,
      runtimeCost:blocked?null:runtime,
      runtimeCostKnown:!blocked,
      runtimeCostStatus:blocked?'semantic_review_blocked':(muCrosswalk?'implemented_inferred':'implemented_verified'),
      runtimeCostInference:[...new Set(inference)],
      runtimeUpkeepCost:{neutral:upkeep},runtimeUpkeepNeutral:upkeep,
      runtimeUpkeepStatus:upkeep?'mu_81_manual_neutral_crosswalk_inferred':'zero_upkeep'
    };
  }

  function normalize(raw) {
    if(!raw||typeof raw!=='object') throw new TypeError('FM1 card record must be an object');
    const detail=fieldMap(raw,'분류별'),meta=fieldMap(raw,'기타'),textFields=fieldMap(raw,'텍스트');
    const type=mappedType(raw.type||meta['분류']||raw.category);
    const attribute=raw.faction||raw.attribute||meta['속성']||'neutral';
    const colors=parseColors(Array.isArray(raw.souls)&&raw.souls.length?raw.souls:attribute).filter(c=>c!=='neutral');
    const faction=COLORS.includes(raw.faction)?raw.faction:(colors[0]||'neutral');
    const parsedStatTech=parseStatTech(raw);
    const sourceCoinTech=type==='unit'?parseSourceCoinTech(raw.sourceCoinTech):{status:'not-applicable',stats:{},sharedTosses:0,review:[]};
    const statTech=mergeSourceCoinTech(parsedStatTech,sourceCoinTech);
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
    const runtimeCost=normalizeCostObject(raw.runtimeCost);
    const sourceFields=raw.sourceFields&&typeof raw.sourceFields==='object'?raw.sourceFields:{};
    const sourceRequireSoul=sourceFields.RequireSoul??raw.soulCostRaw;
    const sourceSoulRuntime=type!=='land'?parseRequireSoulRuntime(sourceRequireSoul,type):null;
    n.runtimeCostKnown=sourceSoulRuntime?sourceSoulRuntime.runtimeCostKnown===true:(raw.runtimeCostKnown===true&&runtimeCost!==null);
    n.runtimeCost=sourceSoulRuntime?sourceSoulRuntime.runtimeCost:(n.runtimeCostKnown?runtimeCost:null);
    n.runtimeCostStatus=sourceSoulRuntime?sourceSoulRuntime.runtimeCostStatus:String(raw.runtimeCostStatus||'source-not-available');
    n.runtimeCostInference=sourceSoulRuntime?sourceSoulRuntime.runtimeCostInference:(Array.isArray(raw.runtimeCostInference)?raw.runtimeCostInference:[]);
    if(sourceSoulRuntime){
      n.candidateCost=sourceSoulRuntime.candidateCost;
      n.runtimeUpkeepCost=sourceSoulRuntime.runtimeUpkeepCost;
      n.runtimeUpkeepNeutral=sourceSoulRuntime.runtimeUpkeepNeutral;
      n.runtimeUpkeepStatus=sourceSoulRuntime.runtimeUpkeepStatus;
      if(sourceSoulRuntime.runtimeCostStatus==='semantic_review_blocked'){
        n.cost=null;n.costKnown=false;n.costMapped=false;
      }
    }
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
      n.specialSkill2SourceMappingStatus=String(raw.specialSkill2SourceMappingStatus||
        raw.specialSkill2MappingStatus||'no_special_skill');
      const skill2RuleNames={
        skill2_tactical_initiative:'기선제압',
        skill2_devoted_defense:'헌신방어',
        skill2_frenzy_defense:'격노',
        skill2_holy_aura:'홀리오오라',
        skill2_alliance_defense:'얼라이디펜스',
        skill2_racial_defense:'레이셜디펜스',
        skill2_strong_devoted_defense:'강한헌신방어',
        skill2_pressure_defense:'프레셔'
      };
      const skill2RuleId=raw.specialSkill2RuleId==null?null:String(raw.specialSkill2RuleId);
      const skill2RuleAllowed=raw.specialSkill2MappingStatus==='source_card_verified'&&
        raw.specialSkill2RuleAuthority==='card_source'&&
        Object.prototype.hasOwnProperty.call(skill2RuleNames,skill2RuleId)&&
        skill2RuleNames[skill2RuleId]===n.specialSkill2;
      n.specialSkill2MappingStatus=skill2RuleAllowed?'source_card_verified':
        (n.specialSkill2&&n.specialSkill2!=='없음'?'unmapped':'no_special_skill');
      n.specialSkill2RuleId=skill2RuleAllowed?skill2RuleId:null;
      n.specialSkill2RuleAuthority=skill2RuleAllowed?'card_source':null;
      n.specialSkill2ExecutionStatus=skill2RuleAllowed?'source-card-rule-implemented':
        (n.specialSkill2&&n.specialSkill2!=='없음'?'disabled-until-skill2-rule-review':'no-skill');
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
      n.coinTech=statTech;n.coinTechSourceStatus=sourceCoinTech.status;n.coinTechReview=sourceCoinTech.review;
      n.ap=raw.ap!==undefined&&raw.ap!==null&&raw.ap!==''&&Number.isFinite(Number(raw.ap))?Number(raw.ap):statTech.stats.ap?.value;
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
      // Keep the original condition parser status for diagnostics, but assign a
      // deterministic any-unit runtime target when the source wording cannot
      // be mapped. Provenance uncertainty is not an item-use gate.
      if(!n.itemConditions.mapped||(n.itemConditions.unsupported&&n.itemConditions.unsupported.length))n.runtimeItemConditionStatus='fallback_any_unit';
      else if(!n.runtimeItemConditionStatus)n.runtimeItemConditionStatus='source_mapped';
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
      const parsedSimpleEffect=parseCardTextEffect(cardText);
      const declaredRuntimeEffect=String(raw.runtimeEffectDisposition||'');
      const mayRunInferred=declaredRuntimeEffect==='implemented_inferred';
      const mayRunVerified=raw.effectVerified===true||declaredRuntimeEffect==='implemented_verified';
      n.effect=raw.effectVerified===true?raw.effect:
        ((mayRunInferred||mayRunVerified)?(raw.effect||parsedSimpleEffect||null):null);
      n.rules.effectStatus=candidateOnly?'pattern_candidate':(n.effect?'simple-text-mapped':'unmapped-text-effect');
      if(type==='enchant'){
        n.slotLocation=detail['슬롯 위치']||detail['슬롯위치']||'';
        const sm=String(n.slotLocation).match(/슬롯\s*(\d+)/);n.slotIndex=sm?Number(sm[1]):null;
        n.slotOwner=/적군/.test(n.slotLocation)?'enemy':/아군/.test(n.slotLocation)?'own':null;
        n.rules.status=n.slotLocation?'condition-text':'incomplete';
        if(!n.slotLocation)n.rules.unsupportedReason='인챈트 슬롯 위치 조건이 없습니다.';
      }else{
        n.rules.status=candidateOnly?'pattern_candidate':(n.effect?'simple-effect-mapped':'text-effect-only');
        if(!n.effect)n.rules.unsupportedReason='원본 설명은 보존했으나 효과 실행 규칙으로 매핑되지 않았습니다.';
      }
      const supportedEffectTypes=['damage','heal','buff','draw','mill','drain'];
      const effectTargetValid=!n.effect||!['damage','heal','buff','drain'].includes(n.effect.type)||['ownUnit','enemyUnit'].includes(n.effect.target);
      const slotMatchesEffect=type!=='enchant'||!n.effect||!['ownUnit','enemyUnit'].includes(n.effect.target)||
        (n.effect.target==='ownUnit'&&n.slotOwner==='own')||(n.effect.target==='enemyUnit'&&n.slotOwner==='enemy');
      const timingOrSlotReady=type==='spell'?
        /전투시작|전투개시|공격|공격턴|방어|방어턴/.test(String(n.triggerTiming||'').replace(/\s/g,'')):
        false;
      const runtimeEffectReady=!!n.effect&&supportedEffectTypes.includes(n.effect.type)&&effectTargetValid&&slotMatchesEffect&&timingOrSlotReady;
      n.runtimeEffectDisposition=runtimeEffectReady?
        (raw.effectVerified===true?'implemented_verified':(mayRunInferred?'implemented_inferred':'fallback_noop')):
        'fallback_noop';
      if(n.runtimeEffectDisposition==='fallback_noop')n.effect=null;
      if(type==='enchant'){
        n.runtimeEffectDisposition='fallback_noop';
        n.effect=null;
        n.runtimeEffectFallbackReason='enchant-event-duration-handler-not-implemented';
      }else{
        n.runtimeEffectFallbackReason=n.runtimeEffectDisposition==='fallback_noop'?
          (raw.runtimeEffectFallbackReason||'source-effect-clause-not-yet-mapped'):null;
      }
    }else{n.rules.status='incomplete';n.rules.unsupportedReason='원본 카드 종류를 판별하지 못했습니다.';}
    if(type!=='land')n.rules.costStatus=costKnown?'mapped':'missing-from-card-image';
    return n;
  }

  function safeSourceCardUrl(value) {
    try {
      const url = new URL(String(value || ''));
      const pathParts = url.pathname.split('/').filter(Boolean);
      const validCardPath = pathParts.length === 2 && pathParts[0] === 'card' &&
        /^[A-Za-z0-9_-]+$/.test(pathParts[1]);
      if (url.protocol !== 'https:' || url.hostname !== 'fmlunatic.com' ||
          url.username || url.password || !validCardPath) return null;
      return url.href;
    } catch (_) { return null; }
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
  const api = {normalize,normalizeMany,fieldMap,entries,normalizeAbility,mappedType,parseStatTech,parseCoinExpression,parseSourceCoinTech,parseRequireSoulRuntime,parseItemConditions,parseCardTextEffect,htmlToText,dedupeTextBlocks,parseColors,parseSoulProduction,safeSourceCardUrl};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FMCardSchema = api;
})(typeof window !== 'undefined' ? window : globalThis);
