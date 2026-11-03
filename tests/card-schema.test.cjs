const test=require('node:test');
const assert=require('node:assert/strict');
const Schema=require('../app/src/main/assets/game/card-schema.js');

test('maps native land LP, colored soul and generated neutral souls',()=>{
  const card=Schema.normalize({
    id:'L00291S',name:'구름도시',type:'land',faction:'light',requiredLP:2,requiredLPKnown:true,
    landInstallCost:{light:1,neutral:1},landInstallCostKnown:true,
    soulProduction:{colored:{light:1},neutral:0},soulProductionStatus:'source-decoded',
    tabs:{'분류별':['필요LP : 2'],'기타':['분류 : 지형','속성 : 빛']}
  });
  assert.equal(card.requiredLP,2);
  assert.equal(card.requiredLPKnown,true);
  assert.deepEqual(card.landInstallCost,{light:1,neutral:1});
  assert.equal(card.landInstallCostKnown,true);
  assert.deepEqual(card.soulProduction,{colored:{light:1},neutral:0});
  assert.equal(card.rules.status,'mapped');
  assert.equal(card.rules.costStatus,'mapped');
});

test('maps unit ability, rank, skill, and raw AP/DP/HP',()=>{
  const card=Schema.normalize({
    id:'U08673S',name:'엔쉬너',type:'unit',faction:'light',unitAbility:'마법',skill:'컨트롤카드',
    ap:3,dp:1,hp:5,
    tabs:{'분류별':['유닛 능력 : 마법','랭크 : C','스킬 : 컨트롤카드'],'기타':['분류 : 유닛']}
  });
  assert.deepEqual(card.unitAbilityTags,['마법']);
  assert.equal(card.rank,'C');
  assert.equal(card.skill,'컨트롤카드');
  assert.equal(card.ap,3);
  assert.equal(card.dp,1);
  assert.equal(card.hp,5);
});

test('unit with zero AP or DP remains valid when source stats are present',()=>{
  const card=Schema.normalize({id:'unit-zero-ap-dp',name:'영점 유닛',type:'unit',ap:0,dp:0,hp:3,
    cost:{light:1},costKnown:true});
  assert.equal(card.rules.status,'mapped');
  assert.equal(card.ap,0);
  assert.equal(card.dp,0);
  assert.equal(card.hp,3);
});

test('parses FM1 shared-coin stat notation from the unit stat tab',()=>{
  const card=Schema.normalize({
    id:'U-COIN',name:'코인유닛',type:'unit',faction:'light',unitAbility:'마법',
    ap:3,dp:1,hp:5,skill:'일반공격',
    tabs:{'분류별':['공\n3\n\n-C3\n방\n1\n\n+C1\n체\n5\n\n+2C1']}
  });
  assert.equal(card.coinTech.sharedTosses,3);
  assert.equal(card.coinTech.stats.ap.coin[0].operation,'subtract');
  assert.equal(card.coinTech.stats.ap.coin[0].tosses,3);
  assert.equal(card.coinTech.stats.dp.coin[0].operation,'add');
  assert.equal(card.coinTech.stats.hp.coin[0].multiplier,2);
  assert.equal(card.coinTech.stats.hp.coin[0].operation,'add');
});

test('parses multiplier coin notation and stat immunity markers',()=>{
  const parsed=Schema.parseStatTech({
    tabs:{'분류별':['공\n▲6\n\nXC4\n방\n▼0\n\n-C2\n체\n★4']}
  });
  assert.equal(parsed.stats.ap.marker,'▲');
  assert.equal(parsed.stats.ap.coin[0].operation,'multiply');
  assert.equal(parsed.stats.ap.coin[0].tosses,4);
  assert.equal(parsed.stats.dp.marker,'▼');
  assert.equal(parsed.stats.hp.marker,'★');
});

test('maps item equip ability, coin change and effect text',()=>{
  const card=Schema.normalize({
    id:'I01753S',name:'빛나는부리',type:'item',faction:'light',unitAbility:'만능',
    text:'버드 종족 유닛에게 장착시 스피시즈 상태를 부여',
    tabs:{'분류별':['장착 능력 : 만능','스킬 : 없음','코인 증감 : C+1','코인 확률 : 없음','카드 텍스트 : 버드 종족 유닛에게 장착'],
      '기타':['분류 : 아이템','종족타입 : 버드']}
  });
  assert.deepEqual(card.allowedUnitAbilities,['만능']);
  assert.equal(card.coinDeltaText,'C+1');
  assert.equal(card.coinProbabilityText,'없음');
  assert.match(card.rules.cardText,/버드 종족/);
  assert.equal(card.race,'버드');
});

test('maps spell trigger and duration while keeping natural language text non-executable',()=>{
  const card=Schema.normalize({
    id:'M03861S',name:'선물쟁탈전',type:'spell',faction:'light',
    text:'아군과 적군의 유닛을 교체하고 피해를 준다.',
    description:'발동시점 : 공격/방어\n지속 턴 : 1턴\n상세 카드 설명',
    tabs:{'분류별':['발동시점 : 공격/방어','지속 턴 : 1턴','카드 텍스트 : 아군과 적군의 유닛을 교체하고 피해를 준다.']}
  });
  assert.equal(card.triggerTiming,'공격/방어');
  assert.equal(card.durationTurns,1);
  assert.equal(card.rules.status,'text-effect-only');
  assert.equal(card.effect,null);
  assert.equal(card.sourceDescription,card.description);
});

test('maps enchant owner, slot number, duration and trigger',()=>{
  const card=Schema.normalize({
    id:'E00823S',name:'엔젤스태츄',type:'enchant',faction:'light',
    tabs:{'분류별':['발동시점 : 공격/방어','지속 턴 : 2턴','슬롯 위치 : 아군 슬롯2','카드 텍스트 : 슬롯카드가 유닛이면 공체를 증가']}
  });
  assert.equal(card.triggerTiming,'공격/방어');
  assert.equal(card.durationTurns,2);
  assert.equal(card.slotOwner,'own');
  assert.equal(card.slotIndex,2);
  assert.equal(card.rules.status,'condition-text');
});

test('preserves all FMLunatic source tab text and HTML metadata',()=>{
  const card=Schema.normalize({
    id:'source-1',name:'설명테스트',type:'spell',faction:'light',
    description:'전체 상세 설명',
    tabs:{
      '분류별':[{text:'발동시점 : 공격/방어',html:'<b>발동시점</b>'}],
      '텍스트':[{text:'효과 부가 설명',html:'<i>효과 부가 설명</i>'}],
      '기타':[{text:'덱 수량제한 : 1U',html:'<b>1U</b>'}]
    }
  });
  assert.equal(card.sourceDescription,'전체 상세 설명');
  assert.equal(card.sourceTabs['텍스트'][0].text,'효과 부가 설명');
  assert.equal(card.sourceTabs['텍스트'][0].html,'<i>효과 부가 설명</i>');
  assert.equal(card.rules.text[''],undefined);
});

test('maps native deck copy limits 1U and 4U',()=>{
  const one=Schema.normalize({id:'u1',name:'A',type:'unit',tabs:{'기타':['분류 : 유닛','덱 수량제한 : 1U']}});
  const four=Schema.normalize({id:'u4',name:'B',type:'unit',tabs:{'기타':['분류 : 유닛','덱 수량제한 : 4U']}});
  assert.equal(one.deckLimit,1);
  assert.equal(one.deckLimitText,'1U');
  assert.equal(four.deckLimit,4);
});

test('does not fabricate summon costs when all source cost fields are empty, even with a stale known flag',()=>{
  const card=Schema.normalize({id:'u-no-cost',name:'미상',type:'unit',cost:{},costKnown:true,ap:1,dp:1,hp:1});
  assert.equal(card.cost,null);
  assert.equal(card.costKnown,false);
  assert.equal(card.costMapped,false);
  assert.equal(card.rules.costStatus,'missing-from-card-image');
});

test('normalizeMany rejects missing and duplicate IDs',()=>{
  assert.throws(()=>Schema.normalizeMany([{name:'ID 없음',type:'unit'}]),/Missing or duplicate/);
  assert.throws(()=>Schema.normalizeMany([{id:'same',type:'unit'},{id:'same',type:'unit'}]),/Missing or duplicate/);
});

test('parses FM1 unsigned coin notation as a stat replacement and signed notation as modifiers',()=>{
  const c2=Schema.parseCoinExpression('C2');
  const twoC3=Schema.parseCoinExpression('2C3');
  const minus=Schema.parseCoinExpression('-C1');
  const multiply=Schema.parseCoinExpression('xC2');
  assert.equal(c2.operation,'set');
  assert.equal(c2.multiplier,1);
  assert.equal(twoC3.operation,'set');
  assert.equal(twoC3.multiplier,2);
  assert.equal(twoC3.tosses,3);
  assert.equal(Schema.parseCoinExpression('+2C3').operation,'add');
  assert.equal(minus.operation,'subtract');
  assert.equal(multiply.operation,'multiply');
});

test('terrain uses decoded production tokens and separately records LP and RequireSoul install cost',()=>{
  const card=Schema.normalize({
    id:'L-COST',name:'마르힐라호수',type:'land',faction:'light',
    requiredLP:2,requiredLPKnown:true,
    landInstallCost:{neutral:0},landInstallCostKnown:true,
    soulProduction:{colored:{dark:1,earth:1,light:1},neutral:2},
    soulProductionStatus:'source-decoded',
    tabs:{'분류별':['필요LP : 2']}
  });
  assert.equal(card.requiredLP,2);
  assert.equal(card.landInstallCostKnown,true);
  assert.deepEqual(card.soulProduction,{colored:{dark:1,earth:1,light:1},neutral:2});
  assert.equal(card.rules.costStatus,'mapped');
  assert.equal(card.rules.status,'mapped');
});

test('MagicLand marker is not mistaken for ordinary colored-soul production',()=>{
  const card=Schema.normalize({
    id:'L-MAGIC',name:'매직랜드',type:'land',faction:'light',
    requiredLP:0,requiredLPKnown:true,
    landInstallCost:{light:1},landInstallCostKnown:true,
    soulProduction:{colored:{},neutral:0},soulProductionStatus:'magicland-effect',isMagicLand:true,
    text:'소울코스트시 빛유소울 1을 소각하고 효과를 발동한다.',
    tabs:{'분류별':['필요LP : 0']}
  });
  assert.equal(card.isMagicLand,true);
  assert.deepEqual(card.soulProduction,{colored:{},neutral:0});
  assert.equal(card.rules.status,'special-effect-pending');
  assert.match(card.rules.unsupportedReason,/매직랜드/);
});

test('parses item race restriction from native item text',()=>{
  const card=Schema.normalize({
    id:'I01753S',name:'빛나는부리',type:'item',faction:'light',unitAbility:'만능',
    text:'※ 아군 필드 버드 종족 유닛에게 장착시, 스피시즈 상태 3턴간 부여',
    tabs:{'분류별':['장착 능력 : 만능','카드 텍스트 : ※ 아군 필드 버드 종족 유닛에게 장착시, 스피시즈 상태 3턴간 부여'],
      '기타':['분류 : 아이템','종족타입 : 버드']}
  });
  assert.equal(card.itemConditions.owner,'own');
  assert.equal(card.itemConditions.race,'버드');
  assert.equal(card.itemConditions.mapped,true);
});

test('parses item affiliation restriction from native item text',()=>{
  const card=Schema.normalize({
    id:'I01752S',name:'더스트엑스',type:'item',faction:'earth',unitAbility:'만능',
    text:'아군 필드 라티노반 소속 유닛에게 장착시 클랜 상태 부여',
    tabs:{'분류별':['장착 능력 : 만능','카드 텍스트 : 아군 필드 라티노반 소속 유닛에게 장착시 클랜 상태 부여'],
      '기타':['분류 : 아이템','소속타입 : 라티노반']}
  });
  assert.equal(card.itemConditions.affiliation,'라티노반');
  assert.equal(card.itemConditions.mapped,true);
});


test('HTML-only source tabs and description lines are retained as readable card details',()=>{
  const raw={id:'html-land',name:'HTML 지형',type:'land',
    description:'분류: 지형\n필요LP: 2\n속성: 빛\n생산무소울: 1',
    tabs:{'분류별':[{html:'<div>필요LP: 2</div><p>생산무소울: 1</p>'}],
      '기타':[{html:'<div>속성: 빛</div>'}]},
    landInstallCost:{},landInstallCostKnown:true};
  const card=Schema.normalize(raw);
  assert.equal(card.requiredLP,2);
  assert.equal(card.neutralSoulProduction,1);
  assert.equal(card.faction,'light');
  assert.match(card.sourceTabs['분류별'][0].text,/필요LP: 2/);
  assert.equal(Schema.htmlToText('<p>부가 설명</p>'),'부가 설명');
});

test('spaced spell trigger timing and simple damage text are mapped',()=>{
  const card=Schema.normalize({id:'spell-damage',name:'피해 마법',type:'spell',
    text:'적군 유닛에게 3 HP 데미지',
    tabs:{'분류별':[{text:'발동 시점: 전투 시작시'}]},
    cost:{},costKnown:true});
  assert.equal(card.triggerTiming,'전투 시작시');
  assert.equal(card.effect.type,'damage');
  assert.equal(card.effect.amount,3);
});

test('simple text parser recognises healing, draw, mill and stat buffs',()=>{
  assert.equal(Schema.parseCardTextEffect('아군 유닛의 HP를 2 회복').type,'heal');
  assert.equal(Schema.parseCardTextEffect('카드 2장을 드로우').amount,2);
  assert.equal(Schema.parseCardTextEffect('상대의 덱 카드 1장을 파괴').type,'mill');
  assert.equal(Schema.parseCardTextEffect('아군 유닛의 AP를 +2 증가').ap,2);
});

test('land with no required LP field remains unverified instead of being silently set to zero',()=>{
  const card=Schema.normalize({id:'land-lp-missing',name:'LP 미확인 지형',type:'land',
    soulProduction:{colored:{light:1},neutral:0},soulProductionStatus:'source-decoded'});
  assert.equal(card.requiredLP,null);
  assert.equal(card.requiredLPKnown,false);
  assert.equal(card.rules.requiredLPStatus,'source-missing');
  assert.equal(card.rules.status,'mapped');
  assert.equal(card.rules.costStatus,'installation-cost-needs-review');
  assert.equal(card.landInstallCostKnown,false);
});

test('dual-colour fractional land soul production and LP are preserved',()=>{
  const card=Schema.normalize({id:'dual-land',name:'복합 지형',type:'land',requiredLP:1,
    soulProduction:{colored:{light:0.5,earth:1.5},neutral:0.25}});
  assert.deepEqual(card.soulProduction,{colored:{light:0.5,earth:1.5},neutral:0.25});
  assert.equal(card.requiredLP,1);
  assert.deepEqual(card.souls,['light','earth']);
});


test('stat tech parser reads all three FM1 coin lanes and directional markers',()=>{
  const tech=Schema.parseStatTech({tabs:{'분류별':[{text:'공\n3\nC2\n방\n2\n-C1\n체\n5\nxC2'}]}});
  assert.equal(tech.stats.ap.value,3);
  assert.equal(tech.stats.ap.coin[0].operation,'set');
  assert.equal(tech.stats.ap.coin[0].tosses,2);
  assert.equal(tech.stats.dp.coin[0].operation,'subtract');
  assert.equal(tech.stats.hp.coin[0].operation,'multiply');
  assert.equal(tech.sharedTosses,2);
});

test('parses slot-specific FM1 AP and HP reduction from source card text',()=>{
  const effect=Schema.parseCardTextEffect('적군 필드 유닛 1의 AP/HP를5 감소시킨다.');
  assert.equal(effect.type,'buff');
  assert.equal(effect.target,'enemyUnit');
  assert.equal(effect.slotIndex,1);
  assert.equal(effect.ap,-5);
  assert.equal(effect.hp,-5);
});

test('unit ability aliases normalize to the three FM1 unit ability classes',()=>{
  assert.deepEqual(Schema.normalizeAbility('마법능력/야수능력/장비능력'),['마법','야수','장비']);
});

test('race-only item conditions are valid without an invented unit-ability restriction',()=>{
  const card=Schema.normalize({id:'race-only-item',name:'종족 제한 장비',type:'item',
    text:'아군 필드 버드 종족 유닛에게 장착시',
    tabs:{'분류별':['카드 텍스트 : 아군 필드 버드 종족 유닛에게 장착시']}});
  assert.equal(card.itemConditions.owner,'own');
  assert.equal(card.itemConditions.race,'버드');
  assert.equal(card.itemConditions.mapped,true);
  assert.equal(card.rules.status,'condition-text');
});


test('empty costs do not override a separately populated soulCost and explicit zero beads remain known',()=>{
  const fallback=Schema.normalize({id:'fallback-cost',name:'대체 비용',type:'unit',
    cost:{},soulCost:{fire:1},costKnown:true,ap:1,dp:1,hp:1});
  assert.deepEqual(fallback.cost,{fire:1});
  assert.equal(fallback.costKnown,true);
  const free=Schema.normalize({id:'zero-cost',name:'명시적 0 비용',type:'unit',
    cost:{forest:0},costKnown:true,ap:1,dp:1,hp:1});
  assert.deepEqual(free.cost,{forest:0});
  assert.equal(free.costKnown,true);
});

test('deduplicates repeated original card text and keeps the longest equivalent source block',()=>{
  const blocks=Schema.dedupeTextBlocks([
    {label:'카드 원문',text:'상대 유닛에게 2의 피해를 줍니다.'},
    {label:'원본 상세 설명',text:'상대 유닛에게 2의 피해를 줍니다.'},
    {label:'텍스트 탭',text:'상대 유닛에게   2의 피해를 줍니다.'},
    {label:'추가 설명',text:'발동 시점: 전투 시작'}
  ]);
  assert.equal(blocks.length,2);
  assert.equal(blocks[0].text,'상대 유닛에게 2의 피해를 줍니다.');
  assert.equal(blocks[1].text,'발동 시점: 전투 시작');
});

test('deduplicates short original text excerpts even when punctuation and whitespace differ',()=>{
  const blocks=Schema.dedupeTextBlocks([
    {label:'카드 원문',text:'상대 유닛에게 2의 피해를 준다.'},
    {label:'상세 설명',text:'이 마법은 상대 유닛에게 2 의 피해를 준다! 전투 시작 시 발동한다.'}
  ]);
  assert.equal(blocks.length,1);
  assert.match(blocks[0].text,/전투 시작 시 발동한다/);
});

test('deduplicates a long source excerpt contained in a longer original description',()=>{
  const excerpt='공격 단계에서 상대 유닛에게 2의 피해를 주고, 대상의 HP가 0 이하가 되면 해당 유닛을 파괴합니다.';
  const blocks=Schema.dedupeTextBlocks([
    {label:'카드 원문',text:excerpt},
    {label:'원본 상세 설명',text:'이 카드는 '+excerpt+' 이 효과는 전투 시작 시 발동합니다.'}
  ]);
  assert.equal(blocks.length,1);
  assert.match(blocks[0].text,/전투 시작 시 발동합니다/);
});

test('uses only generated high-confidence image cost mappings for otherwise unknown source costs',()=>{
  const previous=global.FM_VERIFIED_COSTS;
  global.FM_VERIFIED_COSTS={'verified-map-card':{fire:2,neutral:1}};
  try {
    const card=Schema.normalize({id:'verified-map-card',name:'이미지검증 비용',type:'unit',
      cost:{},costKnown:false,ap:1,dp:1,hp:1});
    assert.deepEqual(card.cost,{fire:2,neutral:1});
    assert.equal(card.costKnown,true);
    assert.equal(card.costMapped,true);
    assert.equal(card.costSource,'verified-image-map');
    assert.equal(card.rules.costStatus,'mapped');
  } finally {
    if(previous===undefined) delete global.FM_VERIFIED_COSTS;
    else global.FM_VERIFIED_COSTS=previous;
  }
});


test('accepts the current Firestore adapter shape for all five official card types',()=>{
  const sourceTypes=[
    ['land','지형'],['unit','유닛'],['spell','마법'],['item','아이템'],['enchant','인챈트']
  ];
  for(const [type,label] of sourceTypes){
    const card=Schema.normalize({
      id:'firestore-'+type,name:'Firestore '+label,type,faction:'light',
      cost:type==='land'?{}:{light:1},costKnown:type!=='land',
      text:'원본 TextBase',description:'원본 TextExtra',
      artImage:'12345678901.webp',
      sourceCardUrl:'https://fmlunatic.com/card/12345678901',
      sourceListUrl:'https://fmlunatic.com/cardlist',
      sourceFields:{ID:'12345678901',Category:type==='land'?1:type==='unit'?2:type==='spell'?3:type==='item'?4:5,TextBase:'원본 TextBase'},
      tabs:{
        '기타':[{label:'분류',text:'분류 : '+label}],
        '텍스트':[{label:'카드 텍스트',text:'원본 TextBase'}],
        '분류별':type==='enchant'?[{label:'슬롯 위치',text:'슬롯 위치 : 아군 슬롯2'}]:[]
      }
    });
    assert.equal(card.type,type);
    assert.equal(card.rules.metadata['분류'],label);
    assert.equal(card.sourceCardUrl,'https://fmlunatic.com/card/12345678901');
    assert.equal(card.sourceFields.Category, type==='land'?1:type==='unit'?2:type==='spell'?3:type==='item'?4:5);
    assert.equal(card.artImage,'12345678901.webp');
  }
});

test('keeps unresolved Firestore soul cost unknown instead of turning it into a free card',()=>{
  const card=Schema.normalize({
    id:'firestore-cost-review',name:'비용 판독 검토',type:'unit',
    cost:{},costKnown:false,costMapped:false,soulCostRaw:'8301',
    sourceFields:{RequireSoul:'8301'},ap:1,dp:1,hp:1
  });
  assert.equal(card.cost,null);
  assert.equal(card.costKnown,false);
  assert.equal(card.rules.costStatus,'missing-from-card-image');
  assert.equal(card.sourceFields.RequireSoul,'8301');
});

test('keeps DB effect candidate records visible but does not auto-execute simple-looking source text',()=>{
  const card=Schema.normalize({
    id:'db-candidate-spell',name:'후보 검토 마법',type:'spell',faction:'fire',
    cost:{fire:1},costKnown:true,costMapped:true,
    text:'적 유닛에게 3의 피해를 준다.',
    triggerTiming:'공격/방어',
    effectExecutionStatus:'candidate-only',
    effectVerificationStatus:'pattern_candidate',
    effectCandidates:[{
      verificationStatus:'pattern_candidate',
      spanIntegrityStatus:'exact',
      clauses:[{startChar:0,endChar:15,segmentType:'clause',text:'적 유닛에게 3의 피해를 준다.'}]
    }]
  });
  assert.equal(card.effect,null);
  assert.equal(card.effectExecutionStatus,'candidate-only');
  assert.equal(card.effectVerificationStatus,'pattern_candidate');
  assert.equal(card.effectCandidates.length,1);
  assert.equal(card.rules.effectStatus,'pattern_candidate');
  assert.equal(card.rules.status,'text-effect-only');
});

test('uses only a Manual-verified Skill1 mapping for the executable special-skill rule ID',()=>{
  const card=Schema.normalize({
    id:'manual-skill-card',name:'기술봉쇄 유닛',type:'unit',faction:'dark',
    specialSkill:'기술봉쇄',
    specialSkillMappings:[
      {sourceField:'Skill1',sourceEnumValue:'82',sourceName:'기술봉쇄',
        ruleId:'ability_seal',mappingStatus:'manual_verified',ruleAuthority:'manual'},
      {sourceField:'Skill2',sourceEnumValue:'999',sourceName:'헌신방어',
        ruleId:null,mappingStatus:'unmapped',ruleAuthority:null}
    ]
  });
  assert.equal(card.skill,'기술봉쇄');
  assert.equal(card.specialSkillRuleId,'ability_seal');
  assert.equal(card.specialSkillExecutionStatus,'manual-rule-catalogue-mapped');
  assert.equal(card.specialSkillMappings.length,2);
});

test('community-only candidate Skill1 mappings remain visible but have no executable rule ID',()=>{
  const card=Schema.normalize({
    id:'community-skill-card',name:'강한공포 유닛',type:'unit',faction:'fire',
    specialSkill:'강한공포',
    specialSkillMappings:[
      {sourceField:'Skill1',sourceEnumValue:'800',sourceName:'강한공포',
        ruleId:'strong_fear',mappingStatus:'community_documented_candidate',ruleAuthority:'community'}
    ]
  });
  assert.equal(card.specialSkillMappings[0].ruleId,'strong_fear');
  assert.equal(card.specialSkillRuleId,null);
  assert.equal(card.specialSkillExecutionStatus,'community-candidate-not-executable');
});

test('uses compact Manual-only Skill1 fields without embedding full source mappings in cards.json',()=>{
  const card=Schema.normalize({
    id:'compact-manual-skill',name:'기술봉쇄 유닛',type:'unit',faction:'dark',
    specialSkill:'기술봉쇄',
    specialSkillMappingStatus:'manual_verified',
    specialSkillRuleAuthority:'manual',
    specialSkillRuleId:'ability_seal'
  });
  assert.equal(card.specialSkillRuleId,'ability_seal');
  assert.equal(card.specialSkillMappingStatus,'manual_verified');
  assert.equal(card.specialSkillExecutionStatus,'manual-rule-catalogue-mapped');
  assert.deepEqual(card.specialSkillMappings,[]);
});

test('compact community-only skill metadata cannot become an executable Manual rule',()=>{
  const card=Schema.normalize({
    id:'compact-community-skill',name:'강한공포 유닛',type:'unit',faction:'fire',
    specialSkill:'강한공포',
    specialSkillMappingStatus:'community_documented_candidate',
    specialSkillRuleAuthority:'community',
    specialSkillRuleId:null
  });
  assert.equal(card.specialSkillRuleId,null);
  assert.equal(card.specialSkillMappingStatus,'community_documented_candidate');
  assert.equal(card.specialSkillExecutionStatus,'community-candidate-not-executable');
});


test('keeps Skill1 and Skill2 separate and leaves Skill2 reference-only',()=>{
  const card=Schema.normalize({
    id:'skill-fields-independent',name:'기술 분리 유닛',type:'unit',
    specialSkill:'방어무시 / 헌신방어',
    specialSkill1:'방어무시',specialSkill2:'헌신방어',
    specialSkill1EnumValue:'243',specialSkill2EnumValue:'175',
    specialSkillMappingStatus:'manual_verified',specialSkillRuleAuthority:'manual',
    specialSkillRuleId:'defense_bypass',
    specialSkill2MappingStatus:'unmapped',specialSkill2RuleId:'defense_bypass',
    specialSkill2ExecutionStatus:'manual-rule-catalogue-mapped',
    ap:3,dp:2,hp:5,cost:{fire:1},costKnown:true,costMapped:true
  });
  assert.equal(card.specialSkill1,'방어무시');
  assert.equal(card.specialSkill2,'헌신방어');
  assert.equal(card.specialSkill1EnumValue,'243');
  assert.equal(card.specialSkill2EnumValue,'175');
  assert.equal(card.specialSkillRuleId,'defense_bypass');
  assert.equal(card.specialSkill2RuleId,null);
  assert.equal(card.specialSkill2ExecutionStatus,'disabled-until-skill2-rule-review');
});

test('retains only the eight exact source-card verified Skill2 rules',()=>{
  const card=Schema.normalize({
    id:'skill2-source-verified',name:'두랄의기사',type:'unit',
    specialSkill1:'일반공격기술',specialSkill2:'홀리오오라',
    specialSkill2EnumValue:'source-enum-88',
    specialSkill2SourceMappingStatus:'unmapped',
    specialSkill2MappingStatus:'source_card_verified',
    specialSkill2RuleId:'skill2_holy_aura',
    specialSkill2RuleAuthority:'card_source',
    specialSkill2ExecutionStatus:'source-card-rule-implemented',
    ap:3,dp:2,hp:5,cost:{light:1},costKnown:true,costMapped:true
  });
  assert.equal(card.specialSkill2MappingStatus,'source_card_verified');
  assert.equal(card.specialSkill2SourceMappingStatus,'unmapped');
  assert.equal(card.specialSkill2RuleId,'skill2_holy_aura');
  assert.equal(card.specialSkill2RuleAuthority,'card_source');
  assert.equal(card.specialSkill2ExecutionStatus,'source-card-rule-implemented');
});

test('rejects Skill2 rule IDs that do not match their source ability name',()=>{
  const card=Schema.normalize({
    id:'skill2-spoofed',name:'임의 유닛',type:'unit',
    specialSkill2:'헌신방어',
    specialSkill2MappingStatus:'source_card_verified',
    specialSkill2RuleId:'skill2_holy_aura',
    specialSkill2RuleAuthority:'card_source',
    specialSkill2ExecutionStatus:'source-card-rule-implemented',
    ap:3,dp:2,hp:5,cost:{light:1},costKnown:true,costMapped:true
  });
  assert.equal(card.specialSkill2RuleId,null);
  assert.equal(card.specialSkill2RuleAuthority,null);
  assert.equal(card.specialSkill2ExecutionStatus,'disabled-until-skill2-rule-review');
});
