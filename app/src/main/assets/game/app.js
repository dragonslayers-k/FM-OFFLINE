(function () {
  'use strict';

  const STORE = 'fm_offline_v010';
  const DEMO_DECK_SIZE = 50;
  const ART = { land:'▤', unit:'♜', item:'⚔', spell:'✧', enchant:'◇' };
  const COLOR_LABEL = FM.COLOR_NAMES;
  let cards = [];
  let state = null;
  let selectedHandId = null;
  let selectedUnitId = null;
  let modalContext = null;
  let data = { extraCards: [], deckCounts: null, difficulty: 'normal', deckFaction: 'forest' };
  let logExpanded = true;
  let imageBaseUri = '';
  let authoritativeCardPack = false;
  let cardDataReadError = '';
  let cardById = new Map();
  let cardSearchIndex = new Map();
  let libraryVisibleCount = 60;
  let catalogueVisibleCount = 100;

  function el(id) { return document.getElementById(id); }
  function safeRead() {
    try {
      const raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function safeWrite() {
    try { localStorage.setItem(STORE, JSON.stringify(data)); }
    catch (_) { showDataMessage('저장 공간이 부족합니다. 카드 데이터 크기를 줄여주십시오.', true); }
  }
  function mergeCards() {
    let external = [];
    let packInfo = {};
    let diagnostics = {};
    try {
      if (window.FMNative && typeof window.FMNative.getCardsJson === 'function') {
        const parsedPack = JSON.parse(window.FMNative.getCardsJson() || '[]');
        external = Array.isArray(parsedPack) ? parsedPack
          : (parsedPack && Array.isArray(parsedPack.cards) ? parsedPack.cards : []);
      }
      if (window.FMNative && typeof window.FMNative.getDataPackInfo === 'function') {
        packInfo = JSON.parse(window.FMNative.getDataPackInfo() || '{}');
      }
      if (window.FMNative && typeof window.FMNative.getCardDataDiagnostics === 'function') {
        diagnostics = JSON.parse(window.FMNative.getCardDataDiagnostics() || '{}');
      }
      imageBaseUri = window.FMNative && window.FMNative.getImageBaseUri
        ? window.FMNative.getImageBaseUri() : '';
    } catch (e) { console.warn('외부 카드 데이터팩을 읽지 못했습니다.', e); }

    authoritativeCardPack = packInfo.installed === true;
    cardDataReadError = '';
    const map = new Map();
    if (authoritativeCardPack && Array.isArray(external)) {
      try {
        const normalized = window.FMCardSchema && typeof window.FMCardSchema.normalizeMany === 'function'
          ? window.FMCardSchema.normalizeMany(external) : external;
        normalized.forEach(card => { if (card && card.id) map.set(card.id, card); });
      } catch (e) {
        console.error('FM1 원본 카드 정규화 실패', e);
        showDataMessage('FM1 카드 원본 필드 검증에 실패했습니다: ' + e.message, true);
      }
    }
    // The imported FM1 database is the sole source of playable cards.
    if ((data.extraCards || []).length) { data.extraCards = []; safeWrite(); }
    cards = Array.from(map.values());
    if (authoritativeCardPack && Number(packInfo.installedCards || 0) > 0 &&
        cards.length !== Number(packInfo.installedCards)) {
      const bytes = Number(diagnostics.bytes || 0);
      const limit = Number(diagnostics.limitBytes || 0);
      cardDataReadError = diagnostics.reason && diagnostics.reason !== 'ready'
        ? diagnostics.reason
        : 'WebView parsed ' + cards.length + ' / ' + Number(packInfo.installedCards) + ' installed cards';
      if (bytes && limit && bytes > limit) {
        cardDataReadError += ' (cards.json ' + bytes.toLocaleString() + ' bytes; bridge limit ' + limit.toLocaleString() + ')';
      }
      console.error('Installed FM1 card payload could not be loaded completely:', cardDataReadError);
    }
    cardById = new Map(cards.map(c => [c.id, c]));
    cardSearchIndex = new Map(cards.map(c => [c.id,
      `${c.name || ''} ${c.text || ''} ${c.description || ''} ${c.sourceDescription || ''} ${c.rules?.cardText || ''} ${Object.values(c.rules?.classification || {}).join(' ')} ${Object.values(c.rules?.metadata || {}).join(' ')} ${c.faction || ''} ${c.type || ''} ${c.skill || ''} ${c.unitAbility || ''} ${(c.unitAbilityTags || []).join(' ')} ${c.affiliation || ''} ${c.race || ''} ${c.episode || ''} ${c.rarity || ''} ${c.purchaseRank || ''} ${c.deckLimitText || ''} ${c.triggerTiming || ''} ${c.durationText || ''} ${c.slotLocation || ''} ${c.equipAbility || ''} ${(c.allowedUnitAbilities || []).join(' ')} ${c.itemConditions?.race || ''} ${c.itemConditions?.affiliation || ''}`.toLocaleLowerCase()
    ]));
    window.FM_ALL_CARDS = cards;

    if (authoritativeCardPack && data.deckCounts &&
        Object.keys(data.deckCounts).some(id => !cardById.has(id))) {
      data.deckCounts = null;
      safeWrite();
    }
  }
  function cardArtUrl(path) {
    if (typeof path !== 'string' || !path) return '';
    const match = path.match(/([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp))$/i);
    if (!match || !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp)$/i.test(path)) return '';
    const fileName = match[1];
    if (authoritativeCardPack && imageBaseUri) return imageBaseUri + fileName;
    if (/^cards\//i.test(path)) return path;
    return '';
  }
  function importDataPack() {
    if (!window.FMNative || !window.FMNative.openDataPackPicker) {
      showDataMessage('이 기능은 Android 앱에서 사용할 수 있습니다.', true); return;
    }
    window.FMNative.openDataPackPicker();
  }
  function downloadDataPack() {
    if (!window.FMNative || typeof window.FMNative.openDataPackDownload !== 'function') {
      showDataMessage('카드 데이터 다운로드는 Android 앱에서 사용할 수 있습니다.', true); return;
    }
    try {
      window.FMNative.openDataPackDownload();
    } catch (e) {
      showDataMessage('다운로드 페이지를 열지 못했습니다: ' + (e && e.message ? e.message : e), true);
    }
  }
  window.onNativeDataPackResult = function(status, message) {
    const packStatus = document.getElementById('data-pack-status');
    if (status === 'working') {
      if (packStatus) packStatus.textContent = message;
      showDataMessage(message, false);
      return;
    }
    if (status === 'success') {
      mergeCards();
      libraryVisibleCount = 60;
      catalogueVisibleCount = 100;
      renderData(); renderDeck(); renderLibrary();
      const info = window.FMNative && window.FMNative.getDataPackInfo ? JSON.parse(window.FMNative.getDataPackInfo()) : {};
      if (cardDataReadError || cards.length !== Number(info.installedCards || cards.length)) {
        const detail = cardDataReadError || ('카드 수 불일치: 읽기 ' + cards.length + ' / 설치 ' + Number(info.installedCards || 0));
        if (packStatus) packStatus.textContent = '데이터팩은 저장됐지만 카드 읽기에 실패했습니다 · ' + detail;
        showDataMessage('설치는 완료됐지만 게임 카드 데이터 연결에 실패했습니다. ' + detail, true);
        switchTab('data');
        return;
      }
      startMatch();
      if (packStatus) packStatus.textContent = '정상 연결 · 카드 ' + cards.length.toLocaleString() + '장 · 이미지 ' + Number(info.installedImages || 0).toLocaleString() + '개';
      showDataMessage(message + ' 카드 DB ' + cards.length.toLocaleString() + '장 연결 확인.', false);
    } else {
      if (packStatus) packStatus.textContent = '설치 실패 · 기존 데이터팩은 유지됩니다.';
      showDataMessage(message, true);
    }
  };
  function defaultDeckCounts(faction) {
    if (!cards.length) return {};
    const sample = FM.buildStarterDeck(cards, faction || 'forest');
    const counts = {};
    sample.forEach(c => counts[c.id] = (counts[c.id] || 0) + 1);
    return counts;
  }
  function currentDeckCounts() {
    if (!cards.length) return {};
    if (!data.deckCounts || countDeck(data.deckCounts) !== DEMO_DECK_SIZE) {
      data.deckCounts = defaultDeckCounts(data.deckFaction || 'forest');
      safeWrite();
    }
    return data.deckCounts;
  }
  function countDeck(counts) { return Object.values(counts).reduce((a, n) => a + Number(n || 0), 0); }
  function deckArray(counts) {
    const result = [];
    Object.entries(counts).forEach(([id, qty]) => {
      const card = cardById.get(id);
      if (card) for (let i = 0; i < qty; i++) result.push(FM.clone(card));
    });
    return result;
  }
  function startMatch() {
    if (!cards.length) {
      showDataMessage('사용할 카드 DB가 없습니다. FM1 카드 데이터팩을 먼저 가져와 주십시오.', true);
      switchTab('data');
      return;
    }
    const deck = deckArray(currentDeckCounts());
    if (deck.length !== DEMO_DECK_SIZE) {
      alert(`대전 덱은 현재 데모 기준 ${DEMO_DECK_SIZE}장이어야 합니다. 덱 편집에서 장수를 맞춰주십시오.`);
      switchTab('deck');
      return;
    }
    const aiFaction = ({forest:'fire',fire:'water',water:'dark',dark:'metal',metal:'earth',earth:'light',light:'forest'})[data.deckFaction || 'forest'] || 'fire';
    state = FM.newGame({ cards, playerDeck: deck, aiFaction, difficulty: el('difficulty').value || data.difficulty || 'normal' });
    selectedHandId = null;
    selectedUnitId = null;
    renderAll();
  }
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
    if (name === 'deck') renderDeck();
    if (name === 'library') renderLibrary();
    if (name === 'data') renderData();
  }
  function typeName(type) { return FM.TYPE_NAMES[type] || type; }
  function cardMeta(card) { return `${COLOR_LABEL[card.faction] || '무속성'} · ${typeName(card.type)}`; }
  function statsText(card) {
    if(card.type==='unit'){
      const coin=card.coinTech&&card.coinTech.stats||{};
      const coinText=Object.entries(coin).map(([stat,v])=>stat.toUpperCase()+' '+(v.coin||[]).map(x=>x.source).join('/')).filter(Boolean).join(' · ');
      return 'AP '+card.ap+' · DP '+card.dp+' · HP '+card.hp+' · '+(card.unitAbility||'능력 미상')+' · '+(card.skill||'스킬 없음')+(coinText?' · '+coinText:'');
    }
    if(card.type==='land'){
      if(card.isMagicLand||card.soulProductionStatus==='magicland-effect')
        return '매직랜드 · 소울 코스트 발동 효과 구현 대기';
      const prod=card.soulProduction||{colored:{},neutral:0};
      const colors=Object.entries(prod.colored||{}).filter(([,v])=>Number(v)>0).map(([c,v])=>(COLOR_LABEL[c]||c)+' '+v).join(' + ')||'유색 소울 없음';
      const install=card.landInstallCostKnown===true?FM.costText(card.landInstallCost):'설치 소울 확인 필요';
      return '필요 LP '+(card.requiredLP??'미상')+' · 설치 소울 '+install+' · 생산 '+colors+' · 무소울 '+(prod.neutral??0);
    }
    if(card.type==='item')return '장착 능력 '+(card.equipAbility||'미상')+' · AP '+(card.apBonus||0)+' · DP '+(card.dpBonus||0)+' · HP '+(card.hpBonus||0)+' · 코인 '+(card.coinDeltaText||'미상');
    if(card.type==='enchant')return '발동 '+(card.triggerTiming||'미상')+' · 지속 '+(card.durationText||'미상')+' · 위치 '+(card.slotLocation||'미상')+' · '+(card.effectExecutionStatus==='candidate-only'?'효과 검증 대기':'효과 상태 확인');
    if(card.type==='spell')return '발동 '+(card.triggerTiming||'미상')+' · 지속 '+(card.durationText||'미상')+' · '+(card.effect?effectText(card.effect):'효과 매핑 대기');
    return '특수 효과';
  }
  function costLabel(card) {
    if(card.type==='land'){
      if(card.isMagicLand||card.soulProductionStatus==='magicland-effect')return '매직랜드 효과 구현 대기';
      const install=card.landInstallCostKnown===true?FM.costText(card.landInstallCost):
        (card.costMappingReview?'혼합 설치 비용 검토':'설치 소울 확인 필요');
      return 'LP '+(card.requiredLP??'미상')+' · 설치 소울 '+install;
    }
    if(card.costKnown===true&&card.costMapped===true)return FM.costText(card.cost);
    if(card.costMappingReview)return '혼합 소울 비용 검토';
    if(card.costSemanticReview)return 'NCS/BONUS 의미 검토';
    return '소울 구슬 비용 검증 대기';
  }
  function canEquipOn(card, unit, targetOwnerId = 'player') {
    if (!card || !unit) return false;
    const allowed = card.allowedUnitAbilities || [];
    const abilities = unit.unitAbilityTags || [unit.unitAbility || ''];
    const abilityOk = !allowed.length || allowed.includes('만능') || allowed.some(tag => abilities.includes(tag));
    if (!abilityOk) return false;
    const condition = card.itemConditions;
    if (!condition) return true;
    if (!condition.mapped || (condition.unsupported && condition.unsupported.length)) return false;
    if (condition.owner === 'enemy' && targetOwnerId !== 'ai') return false;
    if (condition.owner === 'own' && targetOwnerId !== 'player') return false;
    if (condition.race && String(unit.race || '') !== condition.race) return false;
    if (condition.affiliation && String(unit.affiliation || '') !== condition.affiliation) return false;
    return true;
  }
  function effectText(effect) {
    if (effect.type === 'damage') return `피해 ${effect.amount}`;
    if (effect.type === 'heal') return `회복 ${effect.amount}`;
    if (effect.type === 'buff') return `AP +${effect.ap || 0} · DP +${effect.dp || 0} · HP +${effect.hp || 0}`;
    if (effect.type === 'draw') return `카드 ${effect.amount || 1}장 보충`;
    return '특수 효과';
  }
  function cardMarkup(card, selected, small) {
    const artPath = cardArtUrl(card.artImage);
    const artContent = artPath
      ? `<img src="${escapeAttr(artPath)}" alt="${escapeAttr(card.name)}" loading="lazy" onerror="this.remove();">`
      : `<div class="card-art-fallback"><strong>${escapeHtml(card.name)}</strong><small>일러스트 없음</small></div>`;
    return `<button type="button" class="card ${selected ? 'selected' : ''} ${small ? 'small-card' : ''}" data-card-id="${escapeAttr(card.instanceId || card.id)}" data-card-detail="${escapeAttr(card.id)}">
      <div class="card-art ${FM.cardArtClass(card)}">${artContent}</div>
      <div class="card-body"><div class="card-name">${escapeHtml(card.name)}</div><div class="card-cost">${escapeHtml(costLabel(card))}</div></div>
    </button>`;
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }
  function soulDisplay(p) {
    const pool = p.soulPool || { colored: {}, neutral: 0 };
    const colored = Object.entries(pool.colored || {})
      .filter(([,n]) => Number(n) > 0)
      .map(([color,n]) => `${COLOR_LABEL[color] || color} ${n}`).join(' · ');
    const neutral = Number(pool.neutral || 0);
    const upkeep = Number(p.neutralUpkeep || 0);
    return `${colored || '속성 0'} · 무소울 ${neutral} · 유지비 ${upkeep}`;
  }
  function renderLands(id,p) {
    const lands=p.lands||[];
    el(id).innerHTML=lands.length?lands.map(l=>{
      const art=cardArtUrl(l.artImage);
      const prod=l.soulProduction||{colored:Object.fromEntries((l.souls||[]).map(c=>[c,l.soulValue||1])),neutral:l.neutralSoulProduction||0};
      const colors=Object.entries(prod.colored||{}).filter(([,v])=>Number(v)>0).map(([c,v])=>(COLOR_LABEL[c]||c)+' '+v).join(' + ')||'유색 생산 없음';
      return '<button type="button" class="land-token" data-card-detail="'+escapeAttr(l.id)+'">'+
        (art?'<img src="'+escapeAttr(art)+'" alt="'+escapeAttr(l.name)+'" loading="lazy" onerror="this.remove();">':'<span class="field-card-fallback">'+escapeHtml(l.name)+'</span>')+
        '<strong>'+escapeHtml(l.name)+'</strong><small>LP '+escapeHtml(l.requiredLP??'미상')+' · 설치 소울 '+escapeHtml(l.landInstallCostKnown===true?FM.costText(l.landInstallCost):'확인 필요')+'</small>'+
        '<small>생산 '+escapeHtml(colors)+' · 무소울 '+escapeHtml(prod.neutral??0)+'</small></button>';
    }).join(''):'<div class="empty-state">아직 설치된 지형이 없습니다.</div>';
  }
  function renderSpells(id,p) {
    const container=el(id);if(!container)return;
    const bySlot=new Map((p.spells||[]).map((s,i)=>[Number(s.slotIndex)||i+1,s]));
    container.innerHTML=Array.from({length:5},(_,i)=>i+1).map(slot=>{
      const spell=bySlot.get(slot);
      if(!spell)return '<div class="spell-slot-empty"><b>S'+slot+'</b><span>빈 슬롯</span></div>';
      const art=cardArtUrl(spell.artImage);
      return '<button type="button" class="spell-token" data-card-detail="'+escapeAttr(spell.id)+'">'+
        '<span class="spell-token-art">'+(art?'<img src="'+escapeAttr(art)+'" alt="" loading="lazy" onerror="this.remove();">':'✧')+'</span>'+
        '<span class="spell-token-name">S'+slot+' · '+escapeHtml(spell.name)+'</span>'+
        '<small>'+escapeHtml(spell.triggerTiming||'발동 시점 미상')+(spell.durationText?' · '+escapeHtml(spell.durationText):'')+'</small></button>';
    }).join('');
  }

  function renderUnits(id,p,selectable) {
    const units=p.units||[];
    const bySlot=new Map(units.map((u,i)=>[Number(u.slotIndex)||i+1,u]));
    el(id).innerHTML=Array.from({length:5},(_,i)=>i+1).map(slot=>{
      const u=bySlot.get(slot);
      if(!u)return '<div class="unit-slot-empty"><b>S'+slot+'</b><span>빈 슬롯</span></div>';
      const art=cardArtUrl(u.artImage),hp=u.hp+'/'+(u.maxHp+(u.itemHP||0));
      const fallback='<div class="unit-fallback"><strong>'+escapeHtml(u.name)+'</strong><span>AP '+FM.totalPower(u,'ap')+' · DP '+FM.totalPower(u,'dp')+' · HP '+hp+'</span></div>';
      const image=art?'<img src="'+escapeAttr(art)+'" alt="'+escapeAttr(u.name)+'" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false;"><span class="unit-fallback" hidden><strong>'+escapeHtml(u.name)+'</strong><span>AP '+FM.totalPower(u,'ap')+' · DP '+FM.totalPower(u,'dp')+' · HP '+hp+'</span></span>':fallback;
      return '<button type="button" class="unit-token '+(selectedUnitId===u.instanceId&&selectable?'selected':'')+'" data-unit-id="'+escapeAttr(u.instanceId)+'" data-card-detail="'+escapeAttr(u.id)+'">'+
        '<span class="unit-art">'+image+'</span><small class="unit-state">S'+slot+' · HP '+hp+(u.equipment&&u.equipment.length?' · 장착 '+u.equipment.length:'')+'</small></button>';
    }).join('');
  }

  function renderAll() {
    if (!state) return;
    const you = state.players.player, ai = state.players.ai;
    const playerPhase = state.activeId === 'player';
    const role = state.attackerId === state.activeId ? '공격' : '방어';
    el('round-label').textContent = `ROUND ${state.round}`;
    el('phase-label').textContent = playerPhase ? `나의 ${role} 준비` : `AI ${role} 준비`;
    el('turn-status').textContent = state.status === 'finished' ? (state.result === 'player' ? '승리' : '패배') : (playerPhase ? '내 차례' : 'AI 처리');
    el('ai-status').textContent = state.status === 'finished' ? (state.result === 'ai' ? '승리' : '패배') : (state.attackerId === 'ai' ? '공격 준비' : '방어 준비');
    el('player-status').textContent = state.status === 'finished' ? (state.result === 'player' ? '승리' : '패배') : (playerPhase ? `${role} 준비 단계` : 'AI 차례');
    el('ai-deck-count').textContent = ai.deck.length;
    el('ai-hand-count').textContent = ai.hand.length;
    el('player-deck-count').textContent = you.deck.length;
    el('player-hand-count').textContent = you.hand.length;
    el('hand-size').textContent = `${you.hand.length} / 6`;
    el('ai-unit-count').textContent = `${ai.units.length}장`;
    el('player-unit-count').textContent = `${you.units.length}장`;
    if (el('ai-spell-count')) el('ai-spell-count').textContent = `${(ai.spells || []).length}장`;
    if (el('player-spell-count')) el('player-spell-count').textContent = `${(you.spells || []).length}장`;
    if (el('ai-land-count')) el('ai-land-count').textContent = `${ai.lands.length}/10`;
    if (el('player-land-count')) el('player-land-count').textContent = `${you.lands.length}/10`;
    el('ai-soul').textContent = `소울 ${soulDisplay(ai)}`;
    el('player-soul').textContent = `소울 ${soulDisplay(you)}`;
    if (el('ai-lp')) el('ai-lp').textContent = `LP ${ai.lp || 0}`;
    if (el('player-lp')) el('player-lp').textContent = `LP ${you.lp || 0}`;
    if (el('ai-deploy-limit')) el('ai-deploy-limit').textContent = `유닛 배치 ${ai.unitDeployedThisPhase || 0}/${ai.unitDeployLimit || 0}`;
    if (el('player-deploy-limit')) el('player-deploy-limit').textContent = `유닛 배치 ${you.unitDeployedThisPhase || 0}/${you.unitDeployLimit || 0}`;
    el('ai-graveyard').textContent = `AI 무덤 ${ai.graveyard.length}`;
    el('player-graveyard').textContent = `내 무덤 ${you.graveyard.length}`;
    el('battle-feed').textContent = state.log[0] ? state.log[0].text : '전투가 시작되면 주요 행동이 여기에 표시됩니다.';
    renderLands('ai-lands', ai); renderLands('player-lands', you);
    renderSpells('ai-spells', ai); renderSpells('player-spells', you);
    renderUnits('ai-units', ai, false); renderUnits('player-units', you, true);
    el('hand-cards').innerHTML = you.hand.map(c => cardMarkup(c, selectedHandId === c.instanceId, false)).join('') || '<div class="empty-state">패가 비어 있습니다.</div>';
    renderSelectedCard();
    el('play-card').disabled = !playerPhase || !selectedHandId || state.status !== 'playing';
    el('discard-card').disabled = !playerPhase || !selectedHandId || state.status !== 'playing';
    const reshuffle = el('reshuffle-hand');
    if (reshuffle) {
      reshuffle.disabled = !playerPhase || state.status !== 'playing' || state.round > 4 ||
        you.reshuffleUsedRound === state.round || you.playedAnyCardThisPhase || you.playedLand ||
        Number(you.unitDeployedThisPhase || 0) > 0 || !you.hand.length;
      reshuffle.textContent = state.round > 4 ? '리셔플 종료 (4턴까지)' :
        you.reshuffleUsedRound === state.round ? '이번 턴 리셔플 사용 완료' : '핸드 다시 받기 · 1장 소각';
    }
    el('end-phase').disabled = !playerPhase || state.status !== 'playing';
    el('end-phase').textContent = playerPhase ? (state.attackerId === 'player' ? '공격 준비 완료' : '방어 준비 완료') : 'AI 진행 중';
    el('game-log').innerHTML = state.log.map(item => `<div class="log-entry">${escapeHtml(item.text)}</div>`).join('');
    el('game-log').style.display = logExpanded ? 'block' : 'none';
    if (state.status === 'finished') {
      const title = state.result === 'player' ? '승리하셨습니다.' : '패배하셨습니다.';
      el('selected-card-panel').textContent = `${title} 새 대전을 시작하거나 덱을 조정할 수 있습니다.`;
    }
  }
  function renderSelectedCard() {
    const box=el('selected-card-panel');
    const card=state&&state.players.player.hand.find(c=>c.instanceId===selectedHandId);
    const unit=state&&selectedUnitId?state.players.player.units.find(u=>u.instanceId===selectedUnitId):null;
    if(!card){
      if(unit){
        box.classList.remove('empty');
        box.innerHTML='<strong>선택 유닛: '+escapeHtml(unit.name)+'</strong> · AP '+FM.totalPower(unit,'ap')+' · DP '+FM.totalPower(unit,'dp')+' · HP '+unit.hp+'/'+(unit.maxHp+(unit.itemHP||0))+
          '<button type="button" class="selected-card-detail" data-open-card-detail="'+escapeAttr(unit.id)+'">유닛 상세 보기</button>';
      }else{box.classList.add('empty');box.textContent='카드 또는 유닛을 선택하십시오.';}
      return;
    }
    box.classList.remove('empty');
    const unitButton=unit?'<button type="button" class="selected-card-detail" data-open-card-detail="'+escapeAttr(unit.id)+'">선택 유닛 상세</button>':'';
    box.innerHTML='<div class="selected-card-main"><strong>'+escapeHtml(card.name)+'</strong> · '+escapeHtml(cardMeta(card))+
      '<small class="selected-card-condition">비용: '+escapeHtml(costLabel(card))+'</small></div>'+
      '<button type="button" class="selected-card-detail" data-open-card-detail="'+escapeAttr(card.id)+'">카드 상세 보기</button>'+unitButton;
  }
  function chooseHand(instanceId) {
    selectedHandId = selectedHandId === instanceId ? null : instanceId;
    renderAll();
  }
  function chooseUnit(instanceId) {
    selectedUnitId = selectedUnitId === instanceId ? null : instanceId;
    renderAll();
  }
  function showTargetModal(title, candidates, callback) {
    modalContext = callback;
    el('target-options').innerHTML = candidates.length ? candidates.map(u => `<button class="target-option" data-target-id="${escapeAttr(u.instanceId)}"><strong>${escapeHtml(u.name)}</strong><small>AP ${FM.totalPower(u,'ap')} · DP ${FM.totalPower(u,'dp')} · HP ${u.hp}/${u.maxHp + (u.itemHP || 0)}</small></button>`).join('') : '<div class="empty-state">선택 가능한 대상이 없습니다.</div>';
    el('target-modal').classList.remove('hidden');
    el('target-modal').querySelector('h2').textContent = title;
  }
  function closeTargetModal() { el('target-modal').classList.add('hidden'); modalContext = null; }
  function playSelectedCard() {
    if (!state || state.activeId !== 'player' || !selectedHandId) return;
    const card = state.players.player.hand.find(c => c.instanceId === selectedHandId);
    if (!card) return;
    let candidates = [], title = '';
    if (card.type === 'item') {
      const targetOwnerId = card.itemConditions && card.itemConditions.owner === 'enemy' ? 'ai' : 'player';
      candidates = state.players[targetOwnerId].units.filter(unit => canEquipOn(card,unit,targetOwnerId));
      title = targetOwnerId === 'ai' ? '장착 조건을 충족하는 적군 유닛' : '장착 조건을 충족하는 아군 유닛';
      if (!candidates.length) { alert('원본 장착 능력·종족·소속 조건에 맞는 유닛이 없습니다.'); return; }
    } else if (card.type === 'enchant') {
      alert('인챈트는 원본 발동 시점·지속 턴·슬롯 위치를 확인할 수 있지만, 카드별 효과가 아직 실행 규칙으로 매핑되지 않아 임의 발동하지 않습니다. 상세 보기에서 원문 조건을 확인할 수 있습니다.');
      return;
    } else if (card.type === 'spell' && ['ownUnit','enemyUnit'].includes(card.effect?.target)) {
      candidates = card.effect.target === 'ownUnit' ? state.players.player.units : state.players.ai.units;
      title = card.effect.target === 'ownUnit' ? '효과를 받을 아군 유닛' : '마법의 대상이 될 적 유닛';
      if (!candidates.length) { alert('효과를 적용할 대상 유닛이 없습니다.'); return; }
    }
    if (candidates.length) {
      showTargetModal(title, candidates, targetId => completePlay(card, targetId));
    } else completePlay(card, null);
  }
  function completePlay(card, targetId) {
    const result = FM.playCard(state, 'player', card.instanceId, targetId);
    closeTargetModal();
    if (!result.ok) { alert(result.reason); return; }
    selectedHandId = null; selectedUnitId = null;
    renderAll();
  }
  function finishPhase() {
    if (!state || state.activeId !== 'player' || state.status !== 'playing') return;
    const result = FM.endPhase(state, 'player');
    if (!result.ok) alert(result.reason);
    selectedHandId = null; selectedUnitId = null;
    renderAll();
  }

  function openCardDetail(id) {
    const card = cardById.get(id) || cards.find(c => c.id === id || c.instanceId === id);
    if (!card) return;
    const artPath = cardArtUrl(card.artImage);
    const art = artPath
      ? `<img class="detail-art-image" src="${escapeAttr(artPath)}" alt="${escapeAttr(card.name)}" title="이미지를 다시 누르면 닫힙니다." onerror="this.remove();">`
      : '<div class="detail-art-placeholder">일러스트를 찾을 수 없습니다.</div>';
    const extra = card.type === 'unit'
      ? `<div class="detail-stats"><b>AP ${card.ap}</b><b>DP ${card.dp}</b><b>HP ${card.hp}</b></div>`
      : '';
    const cardText = card.rules?.cardText || card.text || '';
    const description = card.sourceDescription || card.description || '';
    const tabBlocks = Object.entries(card.sourceTabs || {}).flatMap(([group,items]) =>
      (items || []).filter(item => item && item.text).map(item => ({label:group,text:item.text}))
    );
    const detailBlocks = window.FMCardSchema.dedupeTextBlocks([
      {label:'카드 원문',text:cardText},
      {label:'추가 원본 설명',text:description},
      ...tabBlocks
    ]);
    const contentLabels = new Set(['카드 원문','추가 원본 설명']);
    const originalDescription = detailBlocks.filter(block => contentLabels.has(block.label))
      .map(block => block.text).join('\n\n');
    const contentRows = originalDescription
      ? `<section class="native-rule-panel"><h4>원본 설명</h4><div class="source-description">${escapeHtml(originalDescription)}</div></section>`
      : '';
    const summaryLabels = new Set(['분류','카드 종류','속성','희귀도','카드명','이름','필요LP','필요 LP','소울 비용','소울비용']);
    if(card.type==='unit') ['AP','DP','HP','공격치','방어치','체력치'].forEach(label=>summaryLabels.add(label));
    const tabGroups = new Map();
    detailBlocks.filter(block => !contentLabels.has(block.label)).forEach(block => {
      const filteredText=String(block.text||'').split(/\r?\n/)
        .filter(line=>{
          const match=line.match(/^\s*([^：:]{1,24})\s*[：:]/);
          return !match || !summaryLabels.has(match[1].trim());
        }).join('\n').trim();
      if(!filteredText)return;
      if (!tabGroups.has(block.label)) tabGroups.set(block.label,[]);
      tabGroups.get(block.label).push(filteredText);
    });
    const tabRows = Array.from(tabGroups.entries()).map(([group,items]) =>
      `<section class="native-rule-panel"><h4>${escapeHtml(group)}</h4>${items.map(text => `<div class="source-tab-row">${escapeHtml(text)}</div>`).join('')}</section>`
    ).join('');
    const costWarning = card.type !== 'land' && card.rules?.costStatus !== 'mapped'
      ? '<div class="rule-warning">소울 구슬 비용이 원본 카드 이미지 기준으로 아직 확인되지 않았습니다. 무료로 처리하지 않습니다.</div>' : '';
    const effectWarning = card.type === 'enchant' || (card.type === 'spell' && !card.effect)
      ? '<div class="rule-warning">원문 설명은 보존되어 있지만 실행 효과 매핑이 완료되지 않아 전투 발동을 차단합니다.</div>' : '';
    const ruleWarning = costWarning + effectWarning;
    el('card-detail-content').innerHTML = `<div class="detail-art">${art}</div><h3>${escapeHtml(card.name)}</h3><div class="card-meta">${escapeHtml(cardMeta(card))} · ${escapeHtml(card.rarity || '일반')}</div><div class="detail-cost">비용·설치 조건: ${escapeHtml(costLabel(card))}</div>${extra}${ruleWarning}${contentRows}${tabRows}<small class="detail-id">카드 ID: ${escapeHtml(card.id)}</small>`;
    el('card-modal').classList.remove('hidden');
  }
  function closeCardDetail() { el('card-modal').classList.add('hidden'); }
  function discardSelectedCard() {
    if (!state || state.activeId !== 'player' || !selectedHandId || state.status !== 'playing') return;
    const card = state.players.player.hand.find(c => c.instanceId === selectedHandId);
    if (!card || !confirm(`"${card.name}" 카드를 무덤으로 버리시겠습니까?`)) return;
    const result = FM.discardCard(state, 'player', selectedHandId);
    if (!result.ok) { alert(result.reason); return; }
    selectedHandId = null;
    renderAll();
  }
  function openGraveyard(ownerId) {
    if (!state) return;
    const owner = state.players[ownerId];
    if (!owner) return;
    el('graveyard-title').textContent = ownerId === 'player' ? '내 무덤' : 'AI 무덤';
    el('graveyard-content').innerHTML = owner.graveyard.length
      ? owner.graveyard.slice().reverse().map(c => {
          const art = cardArtUrl(c.artImage);
          return `<button type="button" class="grave-card" data-card-detail="${escapeAttr(c.id)}">${art ? `<img src="${escapeAttr(art)}" alt="" loading="lazy" onerror="this.remove();">` : ''}<span><b>${escapeHtml(c.name)}</b><small>${escapeHtml(cardMeta(c))}</small></span></button>`;
        }).join('')
      : '<div class="empty-state">무덤에 카드가 없습니다.</div>';
    el('graveyard-modal').classList.remove('hidden');
  }
  function closeGraveyard() { el('graveyard-modal').classList.add('hidden'); }
  function renderDeck() {
    const counts = currentDeckCounts();
    const total = countDeck(counts);
    el('deck-count').textContent = total;
    el('deck-progress-bar').style.width = `${Math.min(100, total / DEMO_DECK_SIZE * 100)}%`;
    const entries = Object.entries(counts).filter(([,q]) => q > 0)
      .map(([id,q]) => ({ card: cardById.get(id), qty:q })).filter(x => x.card);
    el('deck-list').innerHTML = entries.length ? entries.map(({card,qty}) => {
      const art = cardArtUrl(card.artImage);
      return `<div class="deck-item" data-card-detail="${escapeAttr(card.id)}"><div class="mini-art ${FM.cardArtClass(card)}">${art ? `<img src="${escapeAttr(art)}" alt="" loading="lazy" onerror="this.remove();">` : ART[card.type]}</div><div class="deck-item-main"><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(cardMeta(card))} · ${escapeHtml(costLabel(card))}</small></div><div class="qty-controls"><button data-deck-minus="${escapeAttr(card.id)}">−</button><b>${qty}</b><button data-deck-plus="${escapeAttr(card.id)}">+</button></div></div>`;
    }).join('') : '<div class="empty-state">덱이 비어 있습니다.</div>';
    renderDeckCatalogue();
  }
  function renderDeckCatalogue(reset = true) {
    if (reset) catalogueVisibleCount = 100;
    const query = (el('deck-search').value || '').trim().toLocaleLowerCase();
    const counts = currentDeckCounts();
    const visible = cards.filter(c => !query || (cardSearchIndex.get(c.id) || '').includes(query));
    const page = visible.slice(0, catalogueVisibleCount);
    el('deck-catalogue').innerHTML = page.map(c => {
      const art = cardArtUrl(c.artImage);
      return `<div class="catalogue-item" data-card-detail="${escapeAttr(c.id)}"><div class="mini-art ${FM.cardArtClass(c)}">${art ? `<img src="${escapeAttr(art)}" alt="" loading="lazy" onerror="this.remove();">` : ART[c.type]}</div><div class="catalogue-main"><strong>${escapeHtml(c.name)}</strong><small>${escapeHtml(cardMeta(c))} · ${escapeHtml(statsText(c))}</small></div><div class="qty-controls"><b>${counts[c.id] || 0}</b><button data-deck-plus="${escapeAttr(c.id)}">+</button></div></div>`;
    }).join('') || '<div class="empty-state">검색 결과가 없습니다.</div>';
    if (visible.length > catalogueVisibleCount) {
      el('deck-catalogue').insertAdjacentHTML('beforeend', `<button id="catalogue-more" class="library-more" type="button">카드 더 보기 · ${catalogueVisibleCount.toLocaleString()} / ${visible.length.toLocaleString()}</button>`);
      el('catalogue-more').addEventListener('click', () => { catalogueVisibleCount += 100; renderDeckCatalogue(false); });
    }
  }
  function adjustDeck(id, delta) {
    const counts = Object.assign({}, currentDeckCounts());
    const next = (counts[id] || 0) + delta;
    if (next < 0) return;
    const card = cards.find(c => c.id === id);
    const rawLimit = Number(card && card.deckLimit);
    const limit = Number.isInteger(rawLimit) ? Math.max(0, Math.min(4, rawLimit)) : 4;
    if (delta > 0 && countDeck(counts) >= DEMO_DECK_SIZE) { alert(`덱은 ${DEMO_DECK_SIZE}장까지 편성할 수 있습니다.`); return; }
    if (delta > 0 && next > limit) { alert(`이 카드는 최대 ${limit}장까지 넣을 수 있습니다.`); return; }
    if (next === 0) delete counts[id]; else counts[id] = next;
    data.deckCounts = counts; safeWrite(); renderDeck();
  }
  function renderLibrary(reset = true) {
    if (reset) libraryVisibleCount = 60;
    const q = (el('library-search').value || '').trim().toLocaleLowerCase();
    const type = el('filter-type').value, faction = el('filter-faction').value;
    const found = cards.filter(c =>
      (type === 'all' || c.type === type) &&
      (faction === 'all' || c.faction === faction) &&
      (!q || (cardSearchIndex.get(c.id) || '').includes(q))
    );
    const page = found.slice(0, libraryVisibleCount);
    const markup = page.map(c => {
      const art = cardArtUrl(c.artImage);
      return `<article class="library-card" data-card-detail="${escapeAttr(c.id)}"><div class="card-art ${FM.cardArtClass(c)}">${art ? `<img src="${escapeAttr(art)}" alt="${escapeAttr(c.name)}" loading="lazy" onerror="this.remove();">` : `<div class="card-art-fallback"><strong>${escapeHtml(c.name)}</strong><small>일러스트 없음</small></div>`}</div><div class="card-body"><div class="card-name">${escapeHtml(c.name)}</div><div class="card-meta">${escapeHtml(cardMeta(c))} · ${escapeHtml(c.rarity || '일반')}</div></div></article>`;
    }).join('');
    const more = found.length > libraryVisibleCount
      ? `<button id="library-more" class="library-more" type="button">카드 더 보기 · ${libraryVisibleCount.toLocaleString()} / ${found.length.toLocaleString()}</button>`
      : '';
    el('library-grid').innerHTML = `<div class="library-result-count">전체 ${cards.length.toLocaleString()}장 · 검색 결과 ${found.length.toLocaleString()}장</div>${markup || '<div class="empty-state">조건에 맞는 카드가 없습니다.</div>'}${more}`;
    const moreButton = el('library-more');
    if (moreButton) moreButton.addEventListener('click', () => { libraryVisibleCount += 60; renderLibrary(false); });
  }
  function showDataMessage(message, error) {
    el('data-message').textContent = message;
    el('data-message').style.color = error ? '#e5a19b' : '#9fe0b8';
  }
  function renderData() {
    el('data-card-count').textContent = cards.length.toLocaleString();
    const status = el('data-pack-status');
    if (status && window.FMNative && window.FMNative.getDataPackInfo) {
      try {
        const info = JSON.parse(window.FMNative.getDataPackInfo());
        status.textContent = info.installed
          ? (cardDataReadError || cards.length !== Number(info.installedCards || cards.length)
              ? '설치됐지만 카드 연결 오류 · ' + cards.length.toLocaleString() + ' / ' + Number(info.installedCards || 0).toLocaleString() + '장 읽음'
              : '정상 연결 · 카드 ' + cards.length.toLocaleString() + '장 · 이미지 ' + Number(info.installedImages || 0).toLocaleString() + '개')
          : '데이터팩이 설치되지 않았습니다.';
      } catch (_) { status.textContent = '데이터팩 상태를 확인할 수 없습니다.'; }
    }
  }
  function bindEvents() {
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    el('new-match').addEventListener('click', startMatch);
    el('difficulty').addEventListener('change', () => { data.difficulty = el('difficulty').value; safeWrite(); });
    el('play-card').addEventListener('click', playSelectedCard);
    el('end-phase').addEventListener('click', finishPhase);
    el('clear-log').addEventListener('click', () => { logExpanded = !logExpanded; renderAll(); });
    el('hand-cards').addEventListener('click', e => {
      const card = e.target.closest('[data-card-id]');
      if (card) chooseHand(card.dataset.cardId);
    });
    el('player-units').addEventListener('click', e => { const unit = e.target.closest('[data-unit-id]'); if (unit) chooseUnit(unit.dataset.unitId); });
    el('selected-card-panel').addEventListener('click', e => { const button = e.target.closest('[data-open-card-detail]'); if (button) openCardDetail(button.dataset.openCardDetail); });
    el('ai-units').addEventListener('click', e => { const unit = e.target.closest('[data-card-detail]'); if (unit) openCardDetail(unit.dataset.cardDetail); });
    ['ai-spells','player-spells'].forEach(id => el(id).addEventListener('click', e => {
      const spell = e.target.closest('[data-card-detail]');
      if (spell) openCardDetail(spell.dataset.cardDetail);
    }));
    ['ai-lands','player-lands'].forEach(id => el(id).addEventListener('click', e => { const land = e.target.closest('[data-card-detail]'); if (land) openCardDetail(land.dataset.cardDetail); }));
    el('deck-list').addEventListener('click', e => {
      const minus = e.target.closest('[data-deck-minus]'), plus = e.target.closest('[data-deck-plus]');
      if (minus) adjustDeck(minus.dataset.deckMinus, -1); else if (plus) adjustDeck(plus.dataset.deckPlus, 1);
      else { const item=e.target.closest('[data-card-detail]'); if(item) openCardDetail(item.dataset.cardDetail); }
    });
    el('deck-catalogue').addEventListener('click', e => { const plus = e.target.closest('[data-deck-plus]'); if (plus) adjustDeck(plus.dataset.deckPlus, 1); else { const item=e.target.closest('[data-card-detail]'); if(item) openCardDetail(item.dataset.cardDetail); } });
    el('library-grid').addEventListener('click', e => { const item=e.target.closest('[data-card-detail]'); if(item) openCardDetail(item.dataset.cardDetail); });
    el('close-card-modal').addEventListener('click', closeCardDetail);
    el('card-modal').addEventListener('click', e => { if(e.target.id==='card-modal' || e.target.classList.contains('detail-art-image')) closeCardDetail(); });
    el('discard-card').addEventListener('click', discardSelectedCard);
    el('reshuffle-hand').addEventListener('click', () => {
      if (!state || state.activeId !== 'player') return;
      const result = FM.reshuffleHand(state,'player');
      if (!result.ok) alert(result.reason);
      selectedHandId = null;
      renderAll();
    });
    el('player-graveyard').addEventListener('click', () => openGraveyard('player'));
    el('ai-graveyard').addEventListener('click', () => openGraveyard('ai'));
    el('close-graveyard').addEventListener('click', closeGraveyard);
    el('graveyard-modal').addEventListener('click', e => { if (e.target.id === 'graveyard-modal') closeGraveyard(); });
    el('graveyard-content').addEventListener('click', e => {
      const card = e.target.closest('[data-card-detail]');
      if (card) { const id = card.dataset.cardDetail; closeGraveyard(); openCardDetail(id); }
    });
    el('save-deck').addEventListener('click', () => { safeWrite(); alert('현재 덱 구성을 기기에 저장했습니다.'); });
    el('starter-deck').addEventListener('click', () => {
      const faction = el('starter-faction').value;
      const sample = FM.buildStarterDeck(cards, faction);
      const counts = {}; sample.forEach(c => counts[c.id] = (counts[c.id] || 0) + 1);
      data.deckCounts = counts; data.deckFaction = faction; safeWrite(); renderDeck();
    });
    el('deck-search').addEventListener('input', () => renderDeckCatalogue(true));
    ['library-search','filter-type','filter-faction'].forEach(id => el(id).addEventListener('input', () => renderLibrary(true)));
    el('import-data-pack').addEventListener('click', importDataPack);
    el('download-data-pack').addEventListener('click', downloadDataPack);
    el('close-modal').addEventListener('click', closeTargetModal);
    el('target-modal').addEventListener('click', e => {
      if (e.target.id === 'target-modal') closeTargetModal();
      const target = e.target.closest('[data-target-id]');
      if (target && modalContext) { const fn = modalContext; const id = target.dataset.targetId; closeTargetModal(); fn(id); }
    });
  }

  function init() {
    const saved = safeRead();
    data = Object.assign(data, saved);
    if (!['easy','normal','hard'].includes(data.difficulty)) data.difficulty = 'normal';
    mergeCards();
    el('difficulty').value = data.difficulty;
    bindEvents();
    startMatch();
    renderDeck(); renderLibrary(); renderData();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
