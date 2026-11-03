(function (root) {
  'use strict';

  const COLORS = ['dark', 'fire', 'water', 'forest', 'metal', 'earth', 'light', 'neutral'];
  const COLOR_NAMES = {
    dark: '암흑', fire: '불', water: '물', forest: '숲',
    metal: '금속', earth: '대지', light: '빛', neutral: '무속성'
  };
  const TYPE_NAMES = { land: '지형', unit: '유닛', item: '아이템', spell: '마법', enchant: '인챈트' };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function uid(prefix) { return (prefix || 'c') + '_' + Math.random().toString(36).slice(2, 10); }
  function sumCost(cost) { return Object.values(cost || {}).reduce((a, n) => a + (Number(n) || 0), 0); }
  function colorName(key) { return COLOR_NAMES[key] || key || '무속성'; }
  function readCost(cost) {
    if(!cost||typeof cost!=='object'||Array.isArray(cost)||Object.keys(cost).length===0)return {ok:false,reason:'비용 데이터가 없습니다. 원본 카드 비용을 확인해야 합니다.'};
    const normalized=Object.fromEntries(COLORS.map(c=>[c,0]));
    for(const [color,value] of Object.entries(cost)){
      if(!COLORS.includes(color)||!Number.isInteger(Number(value))||Number(value)<0)return {ok:false,reason:'비용 데이터 형식이 올바르지 않습니다.'};
      normalized[color]=Number(value);
    }
    return {ok:true,cost:normalized};
  }
  function costText(cost) {
    const parsed = readCost(cost);
    if (!parsed.ok) return '비용 데이터 확인 필요';
    const entries = Object.entries(parsed.cost).filter(([, n]) => n > 0);
    return entries.length ? entries.map(([k, v]) => `${colorName(k)} ${v}`).join(' · ') : '무료';
  }

  function statMarker(unit, stat) {
    const markers = unit && unit.statMarkers || {};
    if (markers[stat]) return markers[stat];
    return unit && unit.statTech && unit.statTech.stats && unit.statTech.stats[stat]
      ? String(unit.statTech.stats[stat].marker || '') : '';
  }
  function canChangeStat(unit, stat, direction) {
    const marker = statMarker(unit,stat);
    if (marker === '*' || marker === '★') return false;
    if ((marker === '▲' || marker === '△') && direction < 0) return false;
    if ((marker === '▼' || marker === '▽') && direction > 0) return false;
    return true;
  }
  function changeUnitStat(unit, stat, delta) {
    const amount = Number(delta || 0);
    if (!amount || !canChangeStat(unit,stat,Math.sign(amount))) return false;
    const tempKey = stat === 'ap' ? 'tempAP' : stat === 'dp' ? 'tempDP' : 'tempHP';
    unit[tempKey] = Number(unit[tempKey] || 0) + amount;
    if (stat === 'hp') unit.hp = Math.min(unit.maxHp + (unit.itemHP || 0) + Number(unit.tempHP || 0),Math.max(0,unit.hp + amount));
    return true;
  }
  function setUnitStat(unit, stat, target) {
    const current = totalPower(unit,stat), next = Number(target);
    if (!Number.isFinite(next)) return false;
    const direction = Math.sign(next-current);
    return !direction ? false : changeUnitStat(unit,stat,next-current);
  }

  const SPECIAL_SKILL_RULE_KEYWORDS = Object.freeze({
    normal_attack: '일반공격',
    defense_bypass: '방어무시',
    fatal_attack: '치명공격',
    piercing_attack: '관통공격',
    weaken_attack: '약화공격',
    petrify_attack: '석화공격',
    vampiric_attack: '흡혈공격',
    aging_attack: '노화공격',
    charge_attack: '돌진공격',
    beast_tamer: '야수조련공격',
    bravery_attack: '용맹공격',
    regeneration: '재생능력',
    frenzy_attack: '광분공격',
    consecutive_attack: '연속공격',
    fear_attack: '공포공격',
    charm_attack: '매료공격',
    ability_seal: '봉쇄공격',
    spell_suppression: '마법봉쇄공격',
    weapon_suppression: '무기뺏기공격',
    copy_attack: '복제공격',
    shield_break: '방패파괴공격',
    curse_attack: '저주공격',
    defensive_use: '방어이용',
    taunt_attack: '조롱',
    confusion_attack: '혼란공격',
    stealth_attack: '은폐공격',
    defense_convert: '방어전환공격'
  });

  const SPECIAL_SKILL_NAME_ALIASES = Object.freeze({
    '일반공격기술':'일반공격',
    '방어무시기술':'방어무시',
    '치명공격기술':'치명공격',
    '관통공격기술':'관통공격',
    '약화공격기술':'약화공격',
    '석화공격기술':'석화공격',
    '흡혈공격기술':'흡혈공격',
    '노화공격기술':'노화공격',
    '돌진공격기술':'돌진공격',
    '야수조련':'야수조련공격',
    '야수조련기술':'야수조련공격',
    '용맹공격기술':'용맹공격',
    '재생공격':'재생능력',
    '재생공격기술':'재생능력',
    '광분공격기술':'광분공격',
    '연속공격기술':'연속공격',
    '공포공격기술':'공포공격',
    '매료공격기술':'매료공격',
    '기술봉쇄':'봉쇄공격',
    '봉쇄공격기술':'봉쇄공격',
    '주문봉쇄':'마법봉쇄공격',
    '마법봉쇄':'마법봉쇄공격',
    '마법봉쇄기술':'마법봉쇄공격',
    '무기봉쇄':'무기뺏기공격',
    '무기뺏기':'무기뺏기공격',
    '무기뺏기기술':'무기뺏기공격',
    '공격복제':'복제공격',
    '복제공격기술':'복제공격',
    '방패파괴기술':'방패파괴',
    '저주공격기술':'저주공격',
    '방어이용기술':'방어이용',
    '조롱능력':'조롱',
    '조롱공격':'조롱',
    '조롱공격기술':'조롱',
    '혼란공격기술':'혼란공격',
    '은폐공격기술':'은폐공격',
    '방어전환':'방어전환공격',
    '방어변환':'방어전환공격',
    '방어전환기술':'방어전환공격'
  });

  function normalizeSpecialSkillForEngine(unit, rawSkill) {
    // DB29/1.3 compact records contain the source Skill1 mapping decision.
    // Only manual_verified + manual authority can execute; community candidates
    // and unmapped enum names must never fall through to string aliases.
    if (unit && typeof unit.specialSkillMappingStatus === 'string' &&
        unit.specialSkillMappingStatus.length) {
      if (unit.tempSkill && String(unit.tempSkill).trim()) {
        const temp = String(unit.tempSkill).replace(/\\s+/g, '');
        return SPECIAL_SKILL_NAME_ALIASES[temp] || temp;
      }
      const allowed = unit.specialSkillMappingStatus === 'manual_verified' &&
        unit.specialSkillRuleAuthority === 'manual';
      const ruleId = allowed ? unit.specialSkillRuleId : null;
      return ruleId && SPECIAL_SKILL_RULE_KEYWORDS[ruleId]
        ? SPECIAL_SKILL_RULE_KEYWORDS[ruleId]
        : '';
    }
    // Compatibility for pre-1.3 transitional records that still bundle mappings.
    if (unit && Array.isArray(unit.specialSkillMappings)) {
      if (unit.tempSkill && String(unit.tempSkill).trim()) {
        const temp = String(unit.tempSkill).replace(/\\s+/g, '');
        return SPECIAL_SKILL_NAME_ALIASES[temp] || temp;
      }
      const ruleId = unit.specialSkillRuleId;
      return ruleId && SPECIAL_SKILL_RULE_KEYWORDS[ruleId]
        ? SPECIAL_SKILL_RULE_KEYWORDS[ruleId]
        : '';
    }
    // Compatibility for legacy/unit-test records without DB29 mapping metadata.
    const normalized = String(rawSkill || '').replace(/\\s+/g, '');
    return SPECIAL_SKILL_NAME_ALIASES[normalized] || normalized;
  }

  function itemMatchesUnit(card, unit, ownerId, targetOwnerId) {
    const condition = card && card.itemConditions;
    if (!condition) return true;
    if (condition.mapped === false || (condition.unsupported && condition.unsupported.length)) return false;
    if (condition.owner === 'own' && targetOwnerId !== ownerId) return false;
    if (condition.owner === 'enemy' && targetOwnerId === ownerId) return false;
    if (condition.race && String(unit.race || '') !== condition.race) return false;
    if (condition.affiliation && String(unit.affiliation || '') !== condition.affiliation) return false;
    return true;
  }

  function validateCardForPlay(card) {
    if(!card||!['land','unit','item','spell','enchant'].includes(card.type))return {ok:false,reason:'카드 종류 또는 데이터가 올바르지 않습니다.'};
    if(card.type!=='land'){
      if(card.costKnown!==true||card.costMapped!==true)return {ok:false,reason:'원본 카드 이미지의 소울 구슬 비용이 아직 검증되지 않았습니다. 무료 카드로 취급하지 않습니다.'};
      const parsed=readCost(card.cost);if(!parsed.ok)return parsed;
    }
    if(card.type==='unit'&&(!Number.isFinite(Number(card.ap))||!Number.isFinite(Number(card.dp))||!Number.isFinite(Number(card.hp))||Number(card.hp)<=0))
      return {ok:false,reason:'유닛의 AP·DP·HP 데이터가 누락되었거나 올바르지 않습니다.'};
    if(card.type==='land'){
      const lp=Number(card.requiredLP),prod=card.soulProduction,legacy=Array.isArray(card.souls)?card.souls:[];
      if(card.requiredLPKnown!==true||card.requiredLP===null||card.requiredLP===undefined||card.requiredLP===''||!Number.isInteger(lp)||lp<0)
        return {ok:false,reason:'지형의 필요LP 원본값이 없거나 검증되지 않았습니다.'};
      if(card.landInstallCostKnown!==true)return {ok:false,reason:'지형 설치에 필요한 RequireSoul 비용이 아직 확인되지 않았습니다. 무료로 처리하지 않습니다.'};
      const installCost=readCost(card.landInstallCost);
      if(!installCost.ok)return {ok:false,reason:'지형 설치 소울 비용을 검증할 수 없습니다: '+installCost.reason};
      if(card.isMagicLand===true||card.soulProductionStatus==='magicland-effect')
        return {ok:false,reason:'매직랜드의 소울 코스트 발동 및 특수효과 실행 규칙은 구현 검증 대기 중입니다. 일반 지형처럼 설치하지 않습니다.'};
      if(card.soulProductionStatus!=='source-decoded')
        return {ok:false,reason:'EarnSoulList 생산 규칙이 검증되지 않은 지형입니다.'};
      if(legacy.some(c=>!COLORS.includes(c)||c==='neutral')||(prod&&(typeof prod!=='object'||!prod.colored||typeof prod.colored!=='object'||
        Object.entries(prod.colored).some(([c,v])=>!COLORS.includes(c)||c==='neutral'||!Number.isFinite(Number(v))||Number(v)<0)||
        !Number.isFinite(Number(prod.neutral))||Number(prod.neutral)<0)))return {ok:false,reason:'지형의 소울 생산 데이터가 올바르지 않습니다.'};
      const ct=prod?Object.values(prod.colored).reduce((s,n)=>s+Number(n||0),0):legacy.length*(Number(card.soulValue)||1);
      const nt=prod?Number(prod.neutral||0):Number(card.neutralSoulProduction||0);
      if(ct+nt<=0)return {ok:false,reason:'소울 생산량이 0인 표준 지형입니다.'};
    }
    if(card.type==='item'){
      const allowed=Array.isArray(card.allowedUnitAbilities)?card.allowedUnitAbilities:[];
      const hasEquipRule=allowed.length>0||card.itemConditions?.universal===true||!!card.itemConditions?.owner||!!card.itemConditions?.race||!!card.itemConditions?.affiliation;
      if(!hasEquipRule)return {ok:false,reason:'아이템 장착 조건 데이터가 없습니다.'};
      if(card.itemConditions&&card.itemConditions.mapped===false)return {ok:false,reason:'아이템의 원본 종족·소속 장착 조건을 해석하지 못해 안전하게 발동을 차단합니다.'};
    }
    if(card.type==='enchant'&&(card.effectExecutionStatus==='candidate-only'||card.effectVerificationStatus==='pattern_candidate'))
      return {ok:false,reason:'인챈트 효과는 SQLite 후보 추출만 완료됐으며 매뉴얼·카드별 테스트로 검증되기 전까지 실행을 차단합니다.'};
    if(card.type==='enchant'&&(!Number.isInteger(Number(card.slotIndex))||Number(card.slotIndex)<1||!['own','enemy'].includes(card.slotOwner)))
      return {ok:false,reason:'인챈트의 원본 슬롯 위치가 확인되지 않아 발동할 수 없습니다.'};
    if(card.type==='spell'){
      const effect=card.effect||{};
      if(!card.triggerTiming)return {ok:false,reason:'마법의 원본 발동 시점 정보가 누락되었습니다.'};
      if(card.durationTurns!=null&&(!Number.isInteger(Number(card.durationTurns))||Number(card.durationTurns)<0))return {ok:false,reason:'마법의 지속 턴 정보가 올바르지 않습니다.'};
      if(!card.effect||!card.effect.type)return {ok:false,reason:'원본 카드 텍스트는 확인되지만 효과 실행 규칙이 아직 매핑되지 않았습니다. 임의 효과로 발동하지 않습니다.'};
      if(!['damage','heal','buff','draw','mill','drain'].includes(effect.type))return {ok:false,reason:'아직 검증되지 않은 마법 효과입니다. 임의로 발동하지 않습니다.'};
      if(['damage','heal','buff','drain'].includes(effect.type)&&!['ownUnit','enemyUnit'].includes(effect.target))return {ok:false,reason:'마법의 대상 조건이 누락되었습니다.'};
    }
    return {ok:true};
  }

  function makePlayer(id, name, deck, isAI) {
    return {
      id, name, isAI: !!isAI,
      deck: deck.map(c => ({ ...clone(c), instanceId: uid(id) })),
      hand: [], lands: [], units: [], spells: [], graveyard: [],
      lp: 0, soulSpent: 0, playedLand: false, soulPool: { colored: {}, neutral: 0 }, neutralUpkeep: 0,
      unitDeployLimit: 0, unitDeployedThisPhase: 0, playedAnyCardThisPhase: false, reshuffleUsedRound: 0,
      matchesWon: 0
    };
  }

  function shuffle(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newGame(options) {
    const opts = options || {};
    const rng = opts.rng || Math.random;
    const cards = opts.cards || root.FM_CARDS || [];
    const playerDeck = opts.playerDeck || buildStarterDeck(cards, opts.playerFaction || 'forest');
    const aiFaction = opts.aiFaction || (opts.playerFaction === 'fire' ? 'water' : 'fire');
    const aiDeck = opts.aiDeck || buildStarterDeck(cards, aiFaction);
    const state = {
      version: 1,
      status: 'playing',
      result: null,
      round: 1,
      attackerId: 'player',
      activeId: 'player',
      prepared: { player: false, ai: false },
      players: {
        player: makePlayer('player', '나', shuffle(playerDeck, rng), false),
        ai: makePlayer('ai', 'AI 상대', shuffle(aiDeck, rng), true)
      },
      log: [],
      settings: { difficulty: opts.difficulty || 'normal', deckSize: playerDeck.length },
      rng
    };
    drawInitialHand(state, 'player');
    drawInitialHand(state, 'ai');
    beginPhase(state, state.attackerId);
    return state;
  }

  function buildStarterDeck(cards, faction) {
    const pool = cards.filter(c => c.faction === faction || c.faction === 'neutral');
    const source = pool.length >= 20 ? pool : cards;
    const lands = source.filter(c => c.type === 'land');
    const units = source.filter(c => c.type === 'unit');
    const others = source.filter(c => c.type === 'item' || c.type === 'spell' || c.type === 'enchant');
    const result = [];
    const used = new Map();
    function addRepeated(list, wanted) {
      if (!list.length) return;
      let added = 0, cursor = 0;
      while (added < wanted && cursor < list.length * 5) {
        const card = list[cursor++ % list.length];
        const limit = Math.max(1, Math.min(4, Number(card.deckLimit) || 4));
        const count = used.get(card.id) || 0;
        if (count < limit) { result.push(clone(card)); used.set(card.id, count + 1); added++; }
      }
    }
    addRepeated(lands, 10);
    addRepeated(units, 24);
    addRepeated(others, 16);
    if (result.length !== 50) throw new Error('합법적인 50장 기본 덱을 구성할 카드가 부족합니다.');
    return result;
  }

  function player(state, id) { return state.players[id]; }
  function opponentId(id) { return id === 'player' ? 'ai' : 'player'; }
  function addLog(state, text) {
    state.log.unshift({ id: uid('log'), round: state.round, text });
    state.log = state.log.slice(0, 35);
  }

  function checkWinner(state) {
    const playerEmpty = state.players.player.deck.length === 0;
    const aiEmpty = state.players.ai.deck.length === 0;
    if (!playerEmpty && !aiEmpty) return false;
    state.status = 'finished';
    if (playerEmpty && aiEmpty) {
      state.result = state.attackerId === 'player' ? 'ai' : 'player';
      addLog(state, '양측 서고가 동시에 소진되었습니다. 공격자가 패배합니다.');
    } else {
      const loser = playerEmpty ? 'player' : 'ai';
      state.result = loser === 'player' ? 'ai' : 'player';
      addLog(state, player(state,loser).name + '의 서고가 소진되었습니다. ' +
        player(state,state.result).name + ' 승리!');
    }
    return true;
  }

  function drawToSix(state, id) {
    const p = player(state, id);
    while (p.hand.length < 6 && p.deck.length > 0) {
      p.hand.push(p.deck.shift());
    }
    if (p.hand.length < 6 && p.deck.length === 0) checkWinner(state);
    return p.hand.length;
  }

  function drawInitialHand(state, id) {
    const p = player(state,id);
    const rng = state.rng || Math.random;
    let attempts = 0;
    do {
      p.hand = [];
      while (p.hand.length < 6 && p.deck.length) p.hand.push(p.deck.shift());
      if (p.hand.some(card => card.type === 'land')) break;
      p.deck = shuffle(p.deck.concat(p.hand),rng);
      p.hand = [];
      attempts++;
    } while (attempts < 20 && p.deck.some(card => card.type === 'land'));
    if (!p.hand.length) drawToSix(state,id);
    if (!p.hand.some(card => card.type === 'land') && p.deck.length === 0) checkWinner(state);
    return p.hand.length;
  }

  function beginPhase(state, id) {
    if (state.status !== 'playing') return;
    state.activeId = id;
    const p = player(state, id);
    p.playedLand = false;
    p.unitDeployedThisPhase = 0;
    p.playedAnyCardThisPhase = false;
    p.lp = Math.max(0, Number(p.lp || 0)) + 1;
    p.soulSpent = 0;
    p.soulPool = generateSoulPool(p.lands);
    p._state = state;
    p.units.forEach(unit => {
      unit.canAttack = true;
      unit.tempAP = 0;
      unit.tempDP = 0;
      unit.tempHP = 0;
      unit.hp = Math.min(unit.hp, unit.maxHp + (unit.itemHP || 0));
    });
    if (state.status !== 'finished') payNeutralUpkeep(p);
    if (state.status !== 'finished') p.unitDeployLimit = Math.floor(poolTotal(p.soulPool) + 1e-9);
    if (state.status !== 'finished') drawToSix(state, id);
    if (state.status !== 'finished') {
      addLog(state, `${p.name}의 ${id === state.attackerId ? '공격' : '방어'} 준비 단계입니다. 소울을 재충전하고 패를 보충했습니다.`);
    }
  }

  function productionOf(land) {
    if(land&&land.soulProduction&&land.soulProduction.colored){
      const colored={};for(const [color,amount] of Object.entries(land.soulProduction.colored))
        if(COLORS.includes(color)&&color!=='neutral')colored[color]=Math.max(0,Number(amount||0));
      return {colored,neutral:Math.max(0,Number(land.soulProduction.neutral??land.neutralSoulProduction??0))};
    }
    const colored={},sources=Array.isArray(land&&land.souls)?land.souls:[land&&land.faction||'neutral'];
    const amount=Number.isFinite(Number(land&&land.soulValue))?Number(land.soulValue):1;
    sources.forEach(color=>{if(COLORS.includes(color)&&color!=='neutral')colored[color]=(colored[color]||0)+amount;});
    return {colored,neutral:Math.max(0,Number(land&&land.neutralSoulProduction||0))};
  }

  function emptySoulPool() {
    return { colored: {}, neutral: 0 };
  }

  function generateSoulPool(lands) {
    const pool = emptySoulPool();
    (lands || []).forEach(land => {
      const output = productionOf(land);
      Object.entries(output.colored).forEach(([color, amount]) => {
        pool.colored[color] = (pool.colored[color] || 0) + Number(amount || 0);
      });
      pool.neutral += Number(output.neutral || 0);
    });
    return pool;
  }

  function poolTotal(pool) {
    return Number(pool && pool.neutral || 0) +
      Object.values(pool && pool.colored || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
  }

  function clonePool(pool) {
    return { colored: { ...(pool && pool.colored || {}) }, neutral: Number(pool && pool.neutral || 0) };
  }

  function findSoulPayment(p, cost) {
    const parsed = readCost(cost);
    if (!parsed.ok) return null;
    const requirements = parsed.cost;
    const pool = p.soulPool || generateSoulPool(p.lands);
    const next = clonePool(pool);
    let coloredRequired = 0;
    for (const [color, amount] of Object.entries(requirements)) {
      if (color === 'neutral' || amount <= 0) continue;
      if (Number(next.colored[color] || 0) < amount) return null;
      next.colored[color] -= amount;
      coloredRequired += amount;
    }
    const genericRequired = Number(requirements.neutral || 0);
    if (poolTotal(next) < genericRequired) return null;
    // FM1's neutral bead is a generic soul requirement; it may be paid from any generated soul.
    let left = genericRequired;
    const useNeutral = Math.min(next.neutral, left);
    next.neutral -= useNeutral;
    left -= useNeutral;
    for (const color of COLORS) {
      if (left <= 0) break;
      const use = Math.min(Number(next.colored[color] || 0), left);
      next.colored[color] = Number(next.colored[color] || 0) - use;
      left -= use;
    }
    if (left > 0) return null;
    return { pool: next, count: coloredRequired + genericRequired, total: coloredRequired + genericRequired };
  }

  function canPay(p, cost) {
    return !!findSoulPayment(p, cost);
  }

  function spendSoul(p, cost) {
    const payment = findSoulPayment(p, cost);
    if (!payment) return false;
    p.soulPool = payment.pool;
    p.soulSpent = Number(p.soulSpent || 0) + payment.count;
    return true;
  }

  function unitNeutralUpkeep(unit) {
    if (!unit || unit.costKnown !== true || unit.costMapped !== true) return Number.POSITIVE_INFINITY;
    const parsed = readCost(unit.cost);
    return parsed.ok ? Number(parsed.cost.neutral || 0) : Number.POSITIVE_INFINITY;
  }

  function payNeutralUpkeep(p) {
    const required = (p.units || []).reduce((sum, unit) => sum + unitNeutralUpkeep(unit), 0);
    p.neutralUpkeep = required;
    const pool = clonePool(p.soulPool || generateSoulPool(p.lands));
    let remaining = required;
    const fromNeutral = Math.min(pool.neutral, remaining);
    pool.neutral -= fromNeutral;
    remaining -= fromNeutral;
    for (const color of COLORS) {
      if (remaining <= 0) break;
      const available = Number(pool.colored[color] || 0);
      const use = Math.min(available, remaining);
      pool.colored[color] = available - use;
      remaining -= use;
    }
    p.soulPool = pool;
    if (remaining > 0) {
      const destroyed = Math.min(remaining, p.deck.length);
      p.deck.splice(0, destroyed);
      addLog(p._state, p.name + '의 무속성 소울 유지비 ' + required +
        ' 중 ' + remaining + '을 지불하지 못해 덱 카드 ' + destroyed + '장을 파괴했습니다.');
      if (!Number.isFinite(required) && p._state) {
        p._state.status = 'finished';
        p._state.result = opponentId(p.id);
        addLog(p._state,'원본 소울 비용을 확인할 수 없는 기존 유닛이 있어 전투를 중단했습니다.');
      }
      if (p._state && p.deck.length === 0) checkWinner(p._state);
    } else if (required > 0) {
      addLog(p._state, p.name + '이(가) 유닛 무속성 소울 유지비 ' + required + '을 지불했습니다.');
    }
    return { required, unpaid: remaining };
  }

  function totalPower(unit, stat) {
    const base = stat === 'ap' ? unit.ap : stat === 'dp' ? unit.dp : unit.maxHp;
    const item = stat === 'ap' ? (unit.itemAP || 0) : stat === 'dp' ? (unit.itemDP || 0) : (unit.itemHP || 0);
    const temp = stat === 'ap' ? (unit.tempAP || 0) : stat === 'dp' ? (unit.tempDP || 0) : (unit.tempHP || 0);
    return base + item + temp;
  }

  function createUnit(card) {
    return {
      ...clone(card), instanceId: card.instanceId || uid('unit'),
      hp: card.hp, maxHp: card.hp,
      itemAP: 0, itemDP: 0, itemHP: 0,
      tempAP: 0, tempDP: 0, tempHP: 0,
      equipment: [], canAttack: true
    };
  }

  function findCard(p, instanceId) {
    return p.hand.find(c => c.instanceId === instanceId);
  }
  function removeHand(p, instanceId) {
    const idx = p.hand.findIndex(c => c.instanceId === instanceId);
    return idx < 0 ? null : p.hand.splice(idx, 1)[0];
  }

  function playCard(state, ownerId, instanceId, targetId) {
    if (state.status !== 'playing' || state.activeId !== ownerId) return { ok: false, reason: '현재 준비 단계가 아닙니다.' };
    const p = player(state, ownerId);
    const card = findCard(p, instanceId);
    if (!card) return { ok: false, reason: '선택한 카드가 패에 없습니다.' };
    const validation=validateCardForPlay(card);
    if(!validation.ok)return validation;
    if (card.type === 'land') {
      if(p.playedLand)return {ok:false,reason:'판타지마스터즈1 규칙상 한 준비 단계에는 지형을 1장만 설치할 수 있습니다.'};
      if(p.lands.length>=10)return {ok:false,reason:'지형은 최대 10장까지 설치할 수 있습니다.'};
      const requiredLP=Number(card.requiredLP);
      if(p.lp<requiredLP)return {ok:false,reason:'랜드 포인트(LP)가 부족합니다. 필요 LP: '+requiredLP+' / 보유 LP: '+p.lp};
      if(!canPay(p,card.landInstallCost))return {ok:false,reason:'지형 설치 소울이 부족합니다. 필요: '+costText(card.landInstallCost)};
      if(!spendSoul(p,card.landInstallCost))return {ok:false,reason:'지형 설치 소울 지불에 실패했습니다. 기존 자원을 유지합니다.'};
      const land=removeHand(p,instanceId);land.ready=true;p.lp-=requiredLP;
      const output=productionOf(land);
      Object.entries(output.colored).forEach(([color,amount])=>{p.soulPool.colored[color]=Number(p.soulPool.colored[color]||0)+Number(amount||0);});
      p.soulPool.neutral+=Number(output.neutral||0);p.lands.push(land);
      p.unitDeployLimit=Math.floor(poolTotal(p.soulPool)+1e-9);
      p.playedLand=true;p.playedAnyCardThisPhase=true;
      addLog(state,p.name+'이(가) 지형 '+card.name+'을(를) 설치했습니다. (LP -'+requiredLP+
        ', 설치 소울 지불 '+costText(card.landInstallCost)+
        ', 유색 소울 +'+Object.values(output.colored).reduce((a,b)=>a+Number(b||0),0)+
        ', 무속성 소울 +'+Number(output.neutral||0)+')');
      return {ok:true};
    }
if (card.type === 'unit') {
      if (p.units.length >= 5) return {ok:false,reason:'유닛 필드는 최대 5개 슬롯까지 사용할 수 있습니다.'};
      if (p.unitDeployedThisPhase >= p.unitDeployLimit) {
        return {ok:false,reason:'이번 준비 단계의 유닛 배치는 지형이 생성한 소울 수(' + p.unitDeployLimit + ')를 초과할 수 없습니다.'};
      }
      if (!spendSoul(p, card.cost)) {
        return {ok:false,reason:'소울이 부족해 유닛을 소환할 수 없습니다.'};
      }
      removeHand(p, instanceId);
      const unit = createUnit(card);
      const occupied = new Set(p.units.map(u => Number(u.slotIndex)).filter(n => Number.isInteger(n) && n > 0));
      let slot = 1;
      while (occupied.has(slot)) slot++;
      unit.slotIndex = slot;
      p.units.push(unit);
      p.unitDeployedThisPhase++;
      p.playedAnyCardThisPhase = true;
      addLog(state, `${p.name}이(가) ${card.name}을(를) ${slot}번 슬롯에 소환했습니다.`);
      return { ok: true };
    }
    if (card.type === 'item' || card.type === 'enchant') {
      const targetOwner = card.type === 'enchant' && card.slotOwner === 'enemy'
        ? player(state, opponentId(ownerId))
        : card.type === 'item' && card.itemConditions && card.itemConditions.owner === 'enemy'
          ? player(state, opponentId(ownerId)) : p;
      const target = targetOwner.units.find(u => u.instanceId === targetId &&
        (card.type !== 'enchant' || Number(u.slotIndex) === Number(card.slotIndex)));
      if (!target) return { ok: false, reason: card.type === 'enchant'
        ? '원본 지정 슬롯에 대상 유닛이 없습니다.' : '장착 대상을 정확히 선택해야 합니다.' };
      if (card.type === 'enchant') {
        return { ok:false, reason:'인챈트의 발동 슬롯과 지속 턴은 원본에서 읽었지만 카드별 효과 문구를 실행 규칙으로 매핑하지 못했습니다. 임의로 장비 능력치로 바꾸지 않고 사용을 차단합니다.' };
      }
      const allowed = Array.isArray(card.allowedUnitAbilities) ? card.allowedUnitAbilities
        : Array.isArray(card.allowedUnitTypes) ? card.allowedUnitTypes : [];
      const targetAbilities = Array.isArray(target.unitAbilityTags) ? target.unitAbilityTags
        : [target.unitAbility || target.unitType || target.subtype || ''].filter(Boolean);
      if (allowed.length && !allowed.includes('만능') && !allowed.some(x => targetAbilities.includes(x))) {
        return { ok:false, reason:'이 아이템은 선택한 유닛 능력에 장착할 수 없습니다.' };
      }
      if (!itemMatchesUnit(card,target,ownerId,targetOwner.id)) {
        return {ok:false,reason:'이 아이템의 원본 종족·소속·아군/적군 장착 조건을 충족하지 않습니다.'};
      }
      if (!spendSoul(p,card.cost)) return {ok:false,reason:'소울 지불에 실패했습니다.'};
      const item = removeHand(p,instanceId);
      target.equipment.push(card.name);
      target.equipmentCards = target.equipmentCards || [];
      target.equipmentCards.push(clone(item));
      const apBonus = Number(card.apBonus || 0), dpBonus = Number(card.dpBonus || 0), hpBonus = Number(card.hpBonus || 0);
      if (apBonus && canChangeStat(target,'ap',Math.sign(apBonus))) target.itemAP += apBonus;
      if (dpBonus && canChangeStat(target,'dp',Math.sign(dpBonus))) target.itemDP += dpBonus;
      if (hpBonus && canChangeStat(target,'hp',Math.sign(hpBonus))) {
        target.itemHP += hpBonus;
        target.hp = Math.min(target.maxHp + target.itemHP,Math.max(0,target.hp + hpBonus));
      }
      if (card.grantsSpecialSkill && card.grantsSpecialSkill !== '없음') { target.skill = card.grantsSpecialSkill; target.tempSkill = null; }
      if (card.effect && card.effect.type === 'aura') target.aura = clone(card.effect);
      p.playedAnyCardThisPhase = true;
      addLog(state,p.name + '이(가) ' + target.name + '에게 ' + card.name + '을(를) 장착했습니다.');
      return {ok:true};
    }
    if (card.type === 'spell') {
      if (p.spells.length >= 5) return {ok:false,reason:'마법 필드는 최대 5개 슬롯까지 사용할 수 있습니다.'};
      const effect = card.effect || {};
      const other = player(state, opponentId(ownerId));
      const targetOwner = effect.target === 'ownUnit' ? p : other;
      const target = ['ownUnit','enemyUnit'].includes(effect.target)
        ? (targetOwner.units.find(u => u.instanceId === targetId) ||
           (Number(effect.slotIndex)>0 ? targetOwner.units.find(u=>Number(u.slotIndex)===Number(effect.slotIndex)) : null)) : null;
      if (['ownUnit','enemyUnit'].includes(effect.target) && !target) {
        return { ok: false, reason: '마법 효과의 정확한 대상 유닛을 선택해야 합니다.' };
      }
      if (!spendSoul(p, card.cost)) return { ok: false, reason: '소울 지불에 실패했습니다.' };
      const spell = removeHand(p, instanceId);
      p.playedAnyCardThisPhase = true;
      spell.instanceId = spell.instanceId || uid('spell');
      spell.slotIndex = (p.spells || []).reduce((max, x) => Math.max(max, Number(x.slotIndex) || 0), 0) + 1;
      spell.selectedTargetId = target ? target.instanceId : null;
      p.spells.push(spell);
      addLog(state, p.name + '이(가) 마법 ' + card.name + '을(를) ' + spell.slotIndex + '번 마법 슬롯에 배치했습니다.');
      return { ok: true };
    }
    return { ok: false, reason: '지원하지 않는 카드 종류입니다.' };
  }

  function reshuffleHand(state, ownerId) {
    const p = state && player(state,ownerId);
    if (!p || state.status !== 'playing' || state.activeId !== ownerId) return {ok:false,reason:'현재 준비 단계에서만 사용할 수 있습니다.'};
    if (state.round > 4) return {ok:false,reason:'리셔플은 첫 4턴까지만 사용할 수 있습니다.'};
    if (p.reshuffleUsedRound === state.round) return {ok:false,reason:'이번 턴의 리셔플은 이미 사용했습니다.'};
    if (p.playedAnyCardThisPhase || p.playedLand || p.unitDeployedThisPhase > 0) return {ok:false,reason:'카드를 필드에 배치한 뒤에는 리셔플할 수 없습니다.'};
    if (!p.hand.length) return {ok:false,reason:'다시 섞을 핸드 카드가 없습니다.'};
    p.deck = shuffle(p.deck.concat(p.hand),state.rng || Math.random);
    p.hand = [];
    if (p.deck.length) p.graveyard.push(p.deck.shift());
    drawToSix(state,ownerId);
    p.reshuffleUsedRound = state.round;
    addLog(state,p.name + '이(가) 리셔플을 사용해 핸드를 다시 받고 카드 1장을 소각했습니다.');
    return {ok:true};
  }

  function discardCard(state, ownerId, instanceId) {
    if (!state || state.status !== 'playing' || state.activeId !== ownerId) {
      return { ok: false, reason: '현재 카드를 버릴 수 있는 준비 단계가 아닙니다.' };
    }
    const owner = player(state, ownerId);
    const index = owner.hand.findIndex(c => c.instanceId === instanceId);
    if (index < 0) return { ok: false, reason: '선택한 카드가 패에 없습니다.' };
    const [card] = owner.hand.splice(index, 1);
    owner.graveyard.push(card);
    addLog(state, `${owner.name}이(가) ${card.name} 카드를 직접 버렸습니다.`);
    return { ok: true, card };
  }

  function applyEffect(state, ownerId, effect, target) {
    const owner = player(state, ownerId);
    const enemy = player(state, opponentId(ownerId));
    const amount = Number(effect.amount || 0);
    if (effect.type === 'damage' && target) {
      const targetOwner = effect.target === 'ownUnit' ? owner : enemy;
      changeUnitStat(target,'hp',-amount);
      if (target.hp <= 0 && statMarker(target,'hp') !== '*' && statMarker(target,'hp') !== '★') destroyUnit(state,targetOwner,target);
    } else if (effect.type === 'buff' && target) {
      changeUnitStat(target,'ap',Number(effect.ap || 0));
      changeUnitStat(target,'dp',Number(effect.dp || 0));
      changeUnitStat(target,'hp',Number(effect.hp || 0));
    } else if (effect.type === 'heal' && target) {
      changeUnitStat(target,'hp',amount);
    } else if (effect.type === 'draw') {
      const count = Math.max(0, Math.min(3, amount || 1));
      for (let i = 0; i < count && owner.deck.length && owner.hand.length < 6; i++) owner.hand.push(owner.deck.shift());
      checkWinner(state);
    } else if (effect.type === 'mill') {
      enemy.deck.splice(0, Math.min(amount, enemy.deck.length));
      checkWinner(state);
    } else if (effect.type === 'drain' && target) {
      const targetOwner = effect.target === 'ownUnit' ? owner : enemy;
      changeUnitStat(target,'hp',-amount);
      if (target.hp <= 0 && statMarker(target,'hp') !== '*' && statMarker(target,'hp') !== '★') destroyUnit(state,targetOwner,target);
      const wounded = owner.units.slice().sort((a, b) => a.hp - b.hp)[0];
      if (wounded) changeUnitStat(wounded,'hp',amount);
    }
  }

  function destroyUnit(state, owner, unit) {
    const idx = owner.units.findIndex(u => u.instanceId === unit.instanceId);
    if (idx >= 0) {
      const [gone] = owner.units.splice(idx,1);
      (gone.equipmentCards || []).forEach(item => owner.graveyard.push(item));
      owner.graveyard.push(gone);
      addLog(state,owner.name + '의 ' + gone.name + '이(가) 파괴되었습니다. 장착 아이템도 함께 소멸했습니다.');
    }
  }

  function flip(rng) { return rng() < 0.5 ? 0 : 1; }

  function coinProfile(unit, rng) {
    const tech = unit.coinTech || {};
    const stats = tech.stats || {};
    let count = Math.max(0, Number(tech.sharedTosses || 0));
    for (const stat of ['ap','dp','hp']) {
      const entry = stats[stat];
      if (entry && Array.isArray(entry.coin)) {
        for (const item of entry.coin) count = Math.max(count, Number(item.tosses || 0));
      }
    }
    const legacy = unit.coin || {};
    for (const stat of ['ap','dp','hp']) count = Math.max(count, Number(legacy[stat + 'Count'] || 0));
    return { rolls:Array.from({length:count},() => flip(rng)), count };
  }

  function rollStat(unit, stat, rng, profile) {
    const base = totalPower(unit,stat);
    const rolls = profile || coinProfile(unit,rng);
    const tech = unit.coinTech && unit.coinTech.stats && unit.coinTech.stats[stat];
    let value = base, count = rolls.count;
    if (statMarker(unit,stat) === '*' || statMarker(unit,stat) === '★') {
      return {value:base,heads:0,count,base,rolls:[]};
    }
    if (tech && Array.isArray(tech.coin) && tech.coin.length) {
      for (const modifier of tech.coin) {
        const heads = rolls.rolls.slice(0,Number(modifier.tosses || 0)).reduce((sum,n)=>sum+n,0);
        const delta = Number(modifier.multiplier || 1) * heads;
        if (modifier.operation === 'subtract') value -= delta;
        else if (modifier.operation === 'multiply') value *= delta;
        else if (modifier.operation === 'set') value = delta;
        else value += delta;
      }
    } else {
      const legacy = unit.coin || {};
      const tossCount = Math.max(0,Number(legacy[stat + 'Count'] || 0));
      const coinValue = Number(legacy[stat + 'Value'] || 0);
      const heads = rolls.rolls.slice(0,tossCount).reduce((sum,n)=>sum+n,0);
      value = base + heads * coinValue;
    }
    const marker = statMarker(unit,stat);
    if ((marker === '▲' || marker === '△') && value < base) value = base;
    if ((marker === '▼' || marker === '▽') && value > base) value = base;
    return {value:Math.round(value),heads:rolls.rolls.reduce((sum,n)=>sum+n,0),count,base,rolls:rolls.rolls};
  }

  function rollCombatStats(unit,rng) {
    const profile = coinProfile(unit,rng);
    return {
      profile,
      ap:rollStat(unit,'ap',rng,profile),
      dp:rollStat(unit,'dp',rng,profile),
      hp:rollStat(unit,'hp',rng,profile)
    };
  }

  function chooseBlocker(attacker, defenders, rng) {
    if (!defenders.length) return null;
    const attackEstimate = totalPower(attacker, 'ap') + (attacker.coin?.apCount || 0) * (attacker.coin?.apValue || 0) * 0.5;
    let best = defenders[0], bestScore = Infinity;
    for (const defender of defenders) {
      const defenseEstimate = totalPower(defender, 'dp') + (defender.coin?.dpCount || 0) * (defender.coin?.dpValue || 0) * 0.5;
      const expectedDamage = Math.max(0, attackEstimate - defenseEstimate);
      const killPenalty = expectedDamage >= defender.hp ? -100 : 0;
      const score = Math.abs(defender.hp - expectedDamage) + killPenalty + (totalPower(defender, 'ap') * 0.1);
      if (score < bestScore) { best = defender; bestScore = score; }
    }
    return best;
  }

  function compactSlots(list) {
    (list || []).forEach((card, index) => { card.slotIndex = index + 1; });
  }

  function unitSoulCount(unit) {
    const parsed = readCost(unit && unit.cost);
    return parsed.ok ? sumCost(parsed.cost) : Number.NaN;
  }

  function resolveSpellSlot(state, ownerId, slotIndex) {
    const owner = player(state, ownerId);
    const idx = (owner.spells || []).findIndex(card => Number(card.slotIndex) === slotIndex);
    if (idx < 0) return false;
    const spellAtSlot = owner.spells[idx];
    const timing = String(spellAtSlot.triggerTiming || '').replace(/\s/g,'');
    const role = ownerId === state.attackerId ? '공격' : '방어';
    const battleStart = /전투시작|전투개시/.test(timing);
    const canAttack = battleStart || /공격|공격턴/.test(timing);
    const canDefend = battleStart || /방어|방어턴/.test(timing);
    if (!timing || (role === '공격' && !canAttack) || (role === '방어' && !canDefend)) return false;
    const [spell] = owner.spells.splice(idx, 1);
    compactSlots(owner.spells);
    const effect = spell.effect || {};
    let target = null;
    let targetOwner = owner;
    if (effect.target === 'enemyUnit') targetOwner = player(state, opponentId(ownerId));
    if (['ownUnit','enemyUnit'].includes(effect.target)) {
      target = targetOwner.units.find(unit => unit.instanceId === spell.selectedTargetId) ||
        (Number(effect.slotIndex)>0 ? targetOwner.units.find(unit=>Number(unit.slotIndex)===Number(effect.slotIndex)) : null) || null;
    }
    if (['ownUnit','enemyUnit'].includes(effect.target) && !target) {
      addLog(state, spell.name + '은(는) 전투 발동 시 유효한 대상이 없어 무덤으로 이동했습니다.');
    } else {
      applyEffect(state, ownerId, effect, target);
      addLog(state, owner.name + '의 마법 ' + spell.name + '이(가) 발동했습니다.');
    }
    owner.graveyard.push(spell);
    checkWinner(state);
    return true;
  }

  function resolveUnitAttack(state, attackingOwner, defendingOwner, attacker, defender, rolledStats) {
    const rng=state.rng||Math.random;
    rolledStats=rolledStats||{attacker:rollCombatStats(attacker,rng),defender:defender?rollCombatStats(defender,rng):null};
    const attackerStats=rolledStats.attacker,attackRoll=attackerStats.ap;
    const canAffectDefender=Number(attackRoll.value||0)>=1;
    if(!defender){
      const damage=unitSoulCount(attacker);
      if(!Number.isFinite(damage)){
        addLog(state,attacker.name+'의 소환 소울 비용이 확인되지 않아 직접 공격을 처리하지 않았습니다.');
        return {damage:0,direct:true,invalidCost:true};
      }
      const removed=Math.min(damage,defendingOwner.deck.length);
      defendingOwner.deck.splice(0,removed);
      addLog(state,attacker.name+'의 직접 공격! 상대 덱에서 '+removed+'장을 파괴했습니다.');
      checkWinner(state);return {damage:removed,direct:true};
    }
    const defenderStats=rolledStats.defender||rollCombatStats(defender,rng),defenseRoll=defenderStats.dp;
    const skill=normalizeSpecialSkillForEngine(attacker,attacker.tempSkill||attacker.skill||'');
    const targetAbilities=Array.isArray(defender.unitAbilityTags)&&defender.unitAbilityTags.length?defender.unitAbilityTags:[String(defender.unitAbility||'')];
    const change=(unit,stats,stat,delta)=>{
      const ok=changeUnitStat(unit,stat,delta);
      if(ok&&stats&&stats[stat])stats[stat].value=Number(stats[stat].value||0)+Number(delta||0);
      return ok;
    };
    const set=(unit,stats,stat,value)=>{
      const ok=setUnitStat(unit,stat,value);
      if(ok&&stats&&stats[stat])stats[stat].value=Number(value);
      return ok;
    };
    let frenzyBonus=0;
    if(skill.includes('광분공격')){
      const sacrifice=Math.max(0,Number(attacker.hp||0)-1);
      if(sacrifice>0&&change(attacker,attackerStats,'hp',-sacrifice))frenzyBonus=sacrifice;
    }
    if(skill.includes('재생능력')||skill.includes('재생공격'))change(attacker,attackerStats,'hp',1);
    // Manual.zip defines bravery/fear as extra attack damage added to AP before
    // normal damage calculation. These two rules still add one damage at AP=0.
    const attackerLevel=Number(attacker.level||0),defenderLevel=Number(defender.level||0);
    let attackPower=Number(attackRoll.value||0);
    if(skill.includes('용맹공격')&&defenderLevel>=attackerLevel)attackPower+=1;
    if(skill.includes('공포공격')&&defenderLevel<=attackerLevel)attackPower+=1;
    let damage;
    if(skill.includes('방어무시'))damage=Math.max(0,attackPower);
    else if(skill.includes('관통공격')){
      const dpBefore=Number(defenseRoll.value||0),requested=Math.min(Math.max(0,dpBefore),Math.max(0,attackPower));
      const applied=requested>0&&change(defender,defenderStats,'dp',-requested)?requested:0;
      damage=Math.max(0,attackPower-applied);
    }else if(skill.includes('치명공격')&&canAffectDefender)damage=Math.max(0,Number(defender.hp||0)-1);
    else if(skill.includes('돌진공격'))damage=Math.max(0,attackPower+Number(attackerStats.dp?.value||0)-Number(defenseRoll.value||0));
    else if(skill.includes('광분공격'))damage=Math.max(0,attackPower+frenzyBonus-Number(defenseRoll.value||0));
    else if(skill.includes('연속공격'))damage=Math.max(0,(attackPower-1)*2-Number(defenseRoll.value||0));
    else if(skill.includes('복제공격')&&canAffectDefender)damage=Math.max(0,Number(defenderStats.ap?.value||0)-Number(defenseRoll.value||0));
    else if(skill.includes('방어이용')&&canAffectDefender)damage=Math.max(0,attackPower+Number(defenseRoll.value||0));
    else damage=Math.max(0,attackPower-Number(defenseRoll.value||0));
    if(canAffectDefender&&skill.includes('약화공격')){change(defender,defenderStats,'ap',-1);change(defender,defenderStats,'dp',-1);}
    if(canAffectDefender&&skill.includes('석화공격')){set(defender,defenderStats,'ap',0);change(defender,defenderStats,'dp',1);}
    if(canAffectDefender&&skill.includes('노화공격'))change(defender,defenderStats,'ap',-2);
    if(canAffectDefender&&skill.includes('야수조련공격')&&targetAbilities.some(x=>String(x).includes('야수')))set(defender,defenderStats,'ap',0);
    if(canAffectDefender&&skill.includes('마법봉쇄공격')&&targetAbilities.some(x=>String(x).includes('마법')))set(defender,defenderStats,'ap',0);
    if(canAffectDefender&&skill.includes('무기뺏기공격')&&targetAbilities.some(x=>String(x).includes('장비')))set(defender,defenderStats,'ap',0);
    if(canAffectDefender&&skill.includes('방패파괴공격')&&Number(defenseRoll.value||0)>=0)set(defender,defenderStats,'dp',0);
    if(canAffectDefender&&skill.includes('저주공격')){change(defender,defenderStats,'ap',-2);change(defender,defenderStats,'dp',-2);}
    if(canAffectDefender&&skill.includes('매료공격')&&damage===0)set(defender,defenderStats,'ap',0);
    if(canAffectDefender&&skill.includes('봉쇄공격')){defender.skill='일반공격기술';defender.tempSkill=null;}
    if(canAffectDefender&&skill.includes('혼란공격')){
      const oldAP=Number(defenderStats.ap?.value||0),oldHP=Number(defender.hp||0);
      if(set(defender,defenderStats,'ap',oldHP)){
        const hpDelta=oldAP-Number(defender.hp||0);
        if(hpDelta!==0)change(defender,defenderStats,'hp',hpDelta);
      }
    }
    if(canAffectDefender&&skill.includes('방어전환공격')&&Number(defenseRoll.value||0)>0)
      set(defender,defenderStats,'dp',-Math.abs(Number(defenseRoll.value||0)));
    const amount=Math.min(Math.max(0,Number(defender.hp||0)),Math.max(0,Number(damage||0)));
    const actual=amount>0&&change(defender,defenderStats,'hp',-amount)?amount:0;
    if(skill.includes('흡혈공격')&&actual>0)change(attacker,attackerStats,'hp',Math.ceil(actual/2));
    if(skill.includes('은폐공격'))change(attacker,attackerStats,'dp',1);
    if(canAffectDefender&&skill.includes('조롱')&&defender.hp>1){
      const lost=Number(defender.hp)-1;
      change(defender,defenderStats,'hp',-lost);change(defender,defenderStats,'ap',lost);
    }
    if(defender.hp<=0&&!['*','★','▲','△'].includes(statMarker(defender,'hp'))){
      destroyUnit(state,defendingOwner,defender);
      addLog(state,attacker.name+'의 '+(skill||'일반 공격')+'으로 '+defender.name+'이(가) 파괴되었습니다. ('+actual+' 피해)');
    }else addLog(state,attacker.name+'의 '+(skill||'일반 공격')+' → '+defender.name+' ('+actual+' 피해)');
    return {damage:actual,defenderAlive:defendingOwner.units.includes(defender)};
  }

  function resolveBattle(state) {
    if (state.status !== 'playing') return;
    const attacker = player(state,state.attackerId);
    const defender = player(state,opponentId(state.attackerId));
    addLog(state,'제 ' + state.round + ' 라운드 슬롯 전투가 시작됩니다.');
    const maxSlots = 5;
    let slot = 1;
    let steps = 0;
    while (slot <= maxSlots && steps < 40 && state.status === 'playing') {
      steps++;
      compactSlots(attacker.spells);
      compactSlots(defender.spells);
      resolveSpellSlot(state,state.attackerId,slot);
      if (state.status!=='playing') break;
      resolveSpellSlot(state,opponentId(state.attackerId),slot);
      if (state.status!=='playing') break;

      compactSlots(attacker.units);
      compactSlots(defender.units);
      let attackingUnit = attacker.units.find(unit=>Number(unit.slotIndex)===slot);
      let defendingUnit = defender.units.find(unit=>Number(unit.slotIndex)===slot);
      if (!attackingUnit) break;

      const rng = state.rng || Math.random;
      let attackerStats = rollCombatStats(attackingUnit,rng);
      let defenderStats = defendingUnit ? rollCombatStats(defendingUnit,rng) : null;
      if (attackingUnit) {
        attackingUnit.hp = attackerStats.hp.value;
        if (attackingUnit.hp <= 0) {
          destroyUnit(state,attacker,attackingUnit);
          continue;
        }
      }
      if (defendingUnit && defenderStats) {
        defendingUnit.hp = defenderStats.hp.value;
        if (defendingUnit.hp <= 0) {
          destroyUnit(state,defender,defendingUnit);
          defendingUnit = null;
          defenderStats = null;
        }
      }

      resolveUnitAttack(state,attacker,defender,attackingUnit,defendingUnit,{
        attacker:attackerStats,defender:defenderStats
      });
      if (state.status!=='playing') break;

      const currentAttacker = attacker.units.find(unit=>unit.instanceId===attackingUnit.instanceId);
      const currentDefender = defendingUnit
        ? defender.units.find(unit=>unit.instanceId===defendingUnit.instanceId) : null;
      if (currentDefender && currentAttacker) {
        resolveUnitAttack(state,defender,attacker,currentDefender,currentAttacker,{
          attacker:defenderStats,defender:attackerStats
        });
      }
      if (state.status!=='playing') break;

      compactSlots(attacker.units);
      compactSlots(defender.units);
      const attackerStillInThisSlot = attacker.units[slot-1] === attackingUnit;
      const defenderStillInThisSlot = defendingUnit
        ? defender.units.some(unit=>unit.instanceId===defendingUnit.instanceId)
        : true;
      if (attackerStillInThisSlot && defenderStillInThisSlot) slot++;
    }
    for (const id of ['player','ai']) {
      const p = player(state,id);
      p.units.forEach(unit=>{
        unit.hp=Math.max(1,unit.maxHp+(unit.itemHP||0));
        unit.tempAP=0;unit.tempDP=0;unit.tempHP=0;
        unit.tempSkill=null;
      });
      compactSlots(p.units);
      compactSlots(p.spells);
    }
    if (state.status==='finished') return;
    state.round++;
    state.attackerId=opponentId(state.attackerId);
    state.prepared={player:false,ai:false};
    beginPhase(state,state.attackerId);
  }

  function endPhase(state, ownerId) {
    if (state.status !== 'playing' || state.activeId !== ownerId) return { ok: false, reason: '현재 준비 단계가 아닙니다.' };
    state.prepared[ownerId] = true;
    const nextId = opponentId(ownerId);
    if (!state.prepared[nextId]) {
      addLog(state, `${player(state, ownerId).name}이(가) 준비를 마쳤습니다.`);
      beginPhase(state, nextId);
      if (player(state, nextId).isAI) runAIPhase(state, nextId);
    } else {
      resolveBattle(state);
      if (state.status === 'playing' && player(state, state.activeId).isAI) runAIPhase(state, state.activeId);
    }
    return { ok: true };
  }

  function bestSpellTarget(state, ownerId, card) {
    const effect = card.effect || {};
    const targetOwner = effect.target === 'ownUnit' ? player(state, ownerId) : player(state, opponentId(ownerId));
    if (!targetOwner.units.length) return null;
    if (effect.target === 'ownUnit') return targetOwner.units.slice().sort((a, b) => totalPower(b, 'ap') - totalPower(a, 'ap'))[0];
    return targetOwner.units.slice().sort((a, b) => a.hp - b.hp)[0];
  }

  function runAIPhase(state, ownerId) {
    const ai = player(state, ownerId);
    if (!ai || !ai.isAI || state.activeId !== ownerId || state.status !== 'playing') return;
    addLog(state, `${ai.name}이(가) 카드를 검토하고 있습니다.`);
    const land=ai.hand.filter(c=>c.type==='land'&&validateCardForPlay(c).ok&&
      Number(c.requiredLP)<=Number(ai.lp||0))
      .sort((a,b)=>Number(a.requiredLP||0)-Number(b.requiredLP||0))[0];
    if(land)playCard(state,ownerId,land.instanceId);

    const maxActions = state.settings.difficulty === 'easy' ? 2 : state.settings.difficulty === 'hard' ? 8 : 5;
    let actions = 0;
    let progressed = true;
    while (progressed && actions < maxActions && state.status === 'playing') {
      progressed = false;
      actions++;
      const candidates = ai.hand.filter(c => c.type !== 'land' && canPay(ai, c.cost) && validateCardForPlay(c).ok && (c.type !== 'unit' || ai.unitDeployedThisPhase < ai.unitDeployLimit));
      const unitCandidates = candidates.filter(c => c.type === 'unit');
      const unitCard = unitCandidates.sort((a, b) => {
        if (state.settings.difficulty === 'hard') {
          const scoreA = (a.ap + a.dp + a.hp) / Math.max(1, sumCost(a.cost));
          const scoreB = (b.ap + b.dp + b.hp) / Math.max(1, sumCost(b.cost));
          return scoreB - scoreA;
        }
        return (sumCost(a.cost) - sumCost(b.cost)) || (b.ap + b.hp - a.ap - a.hp);
      })[0];
      if (unitCard) {
        const result = playCard(state, ownerId, unitCard.instanceId);
        if (result.ok) { progressed = true; continue; }
      }
      const spellCard = candidates.filter(c => c.type === 'spell').map(c => ({ card: c, target: bestSpellTarget(state, ownerId, c) }))
        .filter(x => !['enemyUnit', 'ownUnit'].includes(x.card.effect?.target) || x.target)
        .sort((a, b) => Number(b.card.effect?.amount || 0) - Number(a.card.effect?.amount || 0))[0];
      if (spellCard) {
        const result = playCard(state, ownerId, spellCard.card.instanceId, spellCard.target?.instanceId);
        if (result.ok) { progressed = true; continue; }
      }
      const equip = candidates.filter(c => c.type === 'item' &&
        (!Array.isArray(c.allowedUnitAbilities) || !c.allowedUnitAbilities.length ||
         c.allowedUnitAbilities.includes('만능') ||
         ai.units.some(u => (u.unitAbilityTags || [u.unitAbility || '']).some(tag => c.allowedUnitAbilities.includes(tag)))))
        .sort((a, b) => ((b.apBonus || 0) + (b.dpBonus || 0) + (b.hpBonus || 0)) - ((a.apBonus || 0) + (a.dpBonus || 0) + (a.hpBonus || 0)))[0];
      if (equip && ai.units.length) {
        const allowed = ai.units.filter(u =>
          (!equip.allowedUnitAbilities?.length ||
           equip.allowedUnitAbilities.includes('만능') ||
           (u.unitAbilityTags || [u.unitAbility || '']).some(tag => equip.allowedUnitAbilities.includes(tag))) &&
          itemMatchesUnit(equip,u,ownerId,ownerId));
        const target = allowed.slice().sort((a, b) => totalPower(b, 'ap') - totalPower(a, 'ap'))[0];
        if (target && playCard(state, ownerId, equip.instanceId, target.instanceId).ok) {
          progressed = true;
        }
      }
    }
    if (state.status === 'playing' && state.activeId === ownerId) endPhase(state, ownerId);
  }

  function cardArtClass(card) {
    const f = card.faction || 'neutral';
    return `art-${f}`;
  }

  const api = {
    COLORS, COLOR_NAMES, TYPE_NAMES, clone, uid, sumCost, costText, colorName,
    newGame, buildStarterDeck, drawToSix, canPay, spendSoul, totalPower, validateCardForPlay,
    playCard, discardCard, reshuffleHand, endPhase, resolveBattle, runAIPhase, checkWinner, cardArtClass,
    _test: { makePlayer, beginPhase, rollStat, coinProfile, chooseBlocker, createUnit, applyEffect, resolveUnitAttack, productionOf, readCost, validateCardForPlay, itemMatchesUnit, resolveSpellSlot, statMarker, canChangeStat, changeUnitStat, setUnitStat, normalizeSpecialSkillForEngine, SPECIAL_SKILL_RULE_KEYWORDS }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FM = api;
})(typeof window !== 'undefined' ? window : globalThis);
