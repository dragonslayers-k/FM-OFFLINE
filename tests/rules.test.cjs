const test=require('node:test');
const assert=require('node:assert/strict');
const FM=require('../app/src/main/assets/game/rules.js');
const CardSchema=require('../app/src/main/assets/game/card-schema.js');
const DeckState=require('../app/src/main/assets/game/deck-state.js');

function land(id,color,requiredLP=1,neutral=0){
  return {id,name:id,type:'land',faction:color,souls:[color],soulValue:1,requiredLP,requiredLPKnown:true,
    landInstallCost:{neutral:0},landInstallCostKnown:true,soulProductionStatus:'source-decoded',
    neutralSoulProduction:neutral,soulProduction:{colored:{[color]:1},neutral},
    ready:true};
}
function unit(id,extra={}){
  return {id,name:id,type:'unit',faction:'forest',cost:{forest:1},costKnown:true,costMapped:true,ap:3,dp:2,hp:5,
    maxHp:5,unitAbility:'장비',unitAbilityTags:['장비'],skill:'일반공격',
    itemAP:0,itemDP:0,itemHP:0,tempAP:0,tempDP:0,tempHP:0,equipment:[],...extra,
    maxHp:extra.maxHp??extra.hp??5};
}
function player(id,extra={}){
  return {id,name:id,isAI:id==='ai',deck:Array.from({length:20},(_,i)=>({id:id+'-d'+i})),
    hand:[],lands:[],units:[],spells:[],graveyard:[],lp:0,soulSpent:0,playedLand:false,
    soulPool:{colored:{},neutral:0},neutralUpkeep:0,unitDeployLimit:0,unitDeployedThisPhase:0,playedAnyCardThisPhase:false,reshuffleUsedRound:0,...extra};
}
function state(p,ai,extra={}){
  return {status:'playing',round:1,attackerId:'player',activeId:'player',
    prepared:{player:false,ai:false},players:{player:p,ai},log:[],rng:()=>0.1,...extra};
}

test('conceding while a match is active awards the win to the opponent',()=>{
  const p=player('player',{name:'플레이어'});
  const ai=player('ai',{name:'상대'});
  const s=state(p,ai);
  assert.equal(FM.concede(s,'ai'),true);
  assert.equal(s.status,'finished');
  assert.equal(s.result,'player');
  assert.match(s.log[0].text,/항복했습니다/);
  assert.match(s.log[0].text,/플레이어 승리/);
  assert.equal(FM.concede(s,'player'),false);
  assert.equal(s.result,'player');
});

test('concession rejects unknown sides and incomplete match state',()=>{
  const p=player('player');
  const ai=player('ai');
  const s=state(p,ai);
  assert.equal(FM.concede(s,'spectator'),false);
  assert.equal(FM.concede(null,'player'),false);
  assert.equal(FM.concede({...s,status:'finished'},'player'),false);
  assert.equal(s.status,'playing');
});

test('slot-specific FM1 spell stat effects resolve against the named enemy slot',()=>{
  const target=unit('target',{instanceId:'target-1',slotIndex:1,ap:5,dp:2,hp:8,maxHp:8});
  const spell={id:'spell-slot-debuff',instanceId:'spell-1',name:'적 유닛 약화',type:'spell',
    cost:{forest:0},costKnown:true,costMapped:true,triggerTiming:'공격턴',
    effect:{type:'buff',target:'enemyUnit',slotIndex:1,ap:-5,hp:-5}};
  const p=player('player',{hand:[spell],soulPool:{colored:{},neutral:0}});
  const ai=player('ai',{units:[target]});
  const s=state(p,ai);
  assert.equal(FM.playCard(s,'player','spell-1').ok,true);
  assert.equal(FM._test.resolveSpellSlot(s,'player',1),true);
  assert.equal(FM.totalPower(target,'ap'),0);
  assert.equal(target.hp,3);
});

test('a missing or empty source cost is not silently treated as free',()=>{
  const p=player('player');
  assert.equal(FM.canPay(p,undefined),false);
  assert.equal(FM.canPay(p,null),false);
  assert.equal(FM.canPay(p,{}),false);
  assert.equal(FM.canPay(p,{unknown:1}),false);
  assert.equal(FM.canPay(p,{forest:-1}),false);
  assert.equal(FM.canPay(p,{forest:0}),true);
});

// End-to-end payment regression: inferred flexible-neutral cost must consume real generated souls.
test('inferred NCS/BONUS neutral soul can consume any remaining generated color',()=>{
  const p=player('player',{soulPool:{colored:{forest:1,metal:1},neutral:0}});
  assert.equal(FM.canPay(p,{forest:1,neutral:1}),true);
  assert.equal(FM.spendSoul(p,{forest:1,neutral:1}),true);
  assert.equal(p.soulPool.neutral,0);
  assert.equal(Object.values(p.soulPool.colored).reduce((sum,n)=>sum+Number(n||0),0),0);
  assert.equal(p.soulPool.colored.forest,0);
  assert.equal(p.soulPool.colored.metal,0);
});

test('inferred hybrid soul cost still requires each printed color',()=>{
  const p=player('player',{soulPool:{colored:{forest:1,metal:0},neutral:5}});
  assert.equal(FM.canPay(p,{forest:1,metal:1}),false);
  p.soulPool.colored.metal=1;
  assert.equal(FM.canPay(p,{forest:1,metal:1}),true);
});

test('opening hand is six cards and contains at least one land for both sides',()=>{
  const lands=Array.from({length:10},(_,i)=>land('land'+i,'forest'));
  const units=Array.from({length:40},(_,i)=>unit('unit'+i));
  const deck=lands.concat(units);
  const game=FM.newGame({cards:deck,playerDeck:deck,aiDeck:deck,rng:()=>0.23});
  assert.equal(game.players.player.hand.length,6);
  assert.equal(game.players.ai.hand.length,6);
  assert.ok(game.players.player.hand.some(card=>card.type==='land'));
  assert.ok(game.players.ai.hand.some(card=>card.type==='land'));
  assert.equal(game.activeId,'player');
});

test('fixed-seed full preparation and battle cycle installs land, summons units and hands back the next turn',()=>{
  const makeDeck=()=>Array.from({length:20},(_,i)=>({id:'cycle-filler-'+i,name:'검증용 여분 카드'}));
  const playerLand={...land('player-new-land','light',1,0),instanceId:'player-new-land',
    landInstallCost:{forest:1},landInstallCostKnown:true};
  const playerUnit={...unit('player-attacker',{
    instanceId:'player-attacker-card',name:'고정 시드 공격 유닛',faction:'light',
    cost:{light:1},costKnown:true,costMapped:true,ap:4,dp:0,hp:10,maxHp:10
  })};
  const aiLand={...land('ai-new-land','fire',1,0),instanceId:'ai-new-land'};
  const aiUnit={...unit('ai-defender',{
    instanceId:'ai-defender-card',name:'고정 시드 방어 유닛',faction:'fire',
    cost:{fire:1},costKnown:true,costMapped:true,ap:2,dp:0,hp:10,maxHp:10
  })};
  const p=player('player',{
    lands:[land('player-base-land','forest',1,0)],
    hand:[playerLand,playerUnit],
    deck:makeDeck()
  });
  const ai=player('ai',{
    lands:[land('ai-base-land','fire',1,0)],
    hand:[aiLand,aiUnit],
    deck:makeDeck()
  });
  const s=state(p,ai,{round:1,attackerId:'player',activeId:'player',rng:()=>0.23,
    settings:{difficulty:'easy',deckSize:20}});
  FM._test.beginPhase(s,'player');

  assert.equal(s.activeId,'player');
  assert.equal(p.lp,1);
  assert.equal(p.unitDeployLimit,1);

  const landResult=FM.playCard(s,'player','player-new-land');
  assert.equal(landResult.ok,true,'player installs the paid land');
  assert.equal(p.lands.length,2);
  assert.equal(p.lp,0);
  assert.equal(p.soulPool.colored.light,1);
  assert.equal(p.unitDeployLimit,1);

  const summonResult=FM.playCard(s,'player','player-attacker-card');
  assert.equal(summonResult.ok,true,'player summons the unit using newly generated light soul');
  assert.equal(p.hand.length,4,'the preparation phase refills the starting hand to six before two cards are played');
  assert.equal(p.hand.some(card=>['player-new-land','player-attacker-card'].includes(card.instanceId)),false,
    'both selected cards leave the hand after successful play');
  assert.equal(p.units.length,1);
  assert.equal(p.unitDeployedThisPhase,1);
  assert.equal(p.playedAnyCardThisPhase,true);

  const roundOneLogStart=s.log.length;
  const finishPreparation=FM.endPhase(s,'player');
  assert.equal(finishPreparation.ok,true);
  assert.equal(ai.lands.length,2,'AI installs its land during its preparation phase');
  assert.equal(ai.units.length,1,'AI summons its unit during its preparation phase');
  assert.equal(s.round,2,'both preparations resolve the first slot battle and advance the round');
  assert.equal(s.attackerId,'ai','attacker alternates after the battle');
  assert.equal(s.activeId,'player','AI completes its next preparation before returning control');
  assert.equal(s.prepared.player,false);
  assert.equal(s.prepared.ai,true);
  assert.equal(p.units.length,1);
  assert.equal(ai.units.length,1);
  const roundOneLogs=s.log.slice(0,roundOneLogStart).concat(s.log.slice(roundOneLogStart));
  assert.ok(roundOneLogs.some(entry=>entry.text.includes('라운드 슬롯 전투가 시작됩니다.')));
  assert.ok(roundOneLogs.some(entry=>entry.text.includes('고정 시드 공격 유닛')&&entry.text.includes('피해')));
  assert.ok(roundOneLogs.some(entry=>entry.text.includes('고정 시드 방어 유닛')&&entry.text.includes('피해')));
  assert.equal(p.playedAnyCardThisPhase,false,'the next player phase starts with a clean action flag');
});

test('fixed-seed slot battle ends the match on direct deck depletion without advancing the round',()=>{
  const attacker=unit('final-direct-attacker',{
    instanceId:'final-direct-attacker',
    name:'최종 직접 공격 유닛',
    cost:{forest:2},
    costKnown:true,
    costMapped:true,
    ap:3,dp:1,hp:5,maxHp:5
  });
  const p=player('player',{
    units:[attacker],
    deck:Array.from({length:10},(_,i)=>({id:'winner-deck-'+i}))
  });
  const ai=player('ai',{
    units:[],
    deck:[{id:'last-ai-card-1'},{id:'last-ai-card-2'}]
  });
  const s=state(p,ai,{
    round:4,
    attackerId:'player',
    activeId:'ai',
    prepared:{player:true,ai:true},
    rng:()=>0.23
  });

  FM.resolveBattle(s);

  assert.equal(ai.deck.length,0,'the two-soul direct attack consumes the final two cards in the opposing deck');
  assert.equal(s.status,'finished','deck depletion ends the match inside the real slot-battle path');
  assert.equal(s.result,'player','the player whose unit made the direct attack wins');
  assert.equal(s.round,4,'a finished match must not enter another round');
  assert.equal(s.attackerId,'player','attacker rotation stops after the terminal result');
  assert.equal(s.prepared.player,true);
  assert.equal(s.prepared.ai,true);
  assert.ok(s.log.some(entry=>entry.text.includes('상대 덱에서 2장을 파괴했습니다.')));
  assert.ok(s.log.some(entry=>entry.text.includes('승리!')));
});

test('AI preparation stops immediately when an empty deck cannot refill its hand to six',()=>{
  const p=player('player',{
    hand:Array.from({length:6},(_,i)=>({id:'player-ready-'+i})),
    deck:Array.from({length:10},(_,i)=>({id:'player-deck-'+i}))
  });
  const ai=player('ai',{
    hand:Array.from({length:5},(_,i)=>({id:'ai-ready-'+i})),
    deck:[]
  });
  const s=state(p,ai,{
    round:3,
    attackerId:'player',
    activeId:'player',
    prepared:{player:false,ai:false}
  });

  const result=FM.endPhase(s,'player');

  assert.equal(result.ok,true,'the player can complete the preparation handoff');
  assert.equal(s.status,'finished','AI cannot complete a required draw from an empty deck');
  assert.equal(s.result,'player','the player wins when the AI cannot refill to six');
  assert.equal(ai.hand.length,5,'no phantom card is drawn');
  assert.equal(ai.deck.length,0);
  assert.equal(s.activeId,'ai','the terminal condition occurs during the AI preparation handoff');
  assert.equal(s.round,3,'the failed draw does not advance a round');
  assert.ok(!s.log.some(entry=>entry.text.includes('카드를 검토하고 있습니다.')),
    'AI automation must not start after beginPhase has already ended the match');
  assert.ok(s.log.some(entry=>entry.text.includes(ai.name+'의 서고가 소진되었습니다.')));
});

test('AI preparation stops when neutral upkeep destroys its final deck card',()=>{
  const p=player('player',{
    hand:Array.from({length:6},(_,i)=>({id:'upkeep-player-'+i})),
    deck:Array.from({length:10},(_,i)=>({id:'upkeep-player-deck-'+i}))
  });
  const ai=player('ai',{
    hand:Array.from({length:5},(_,i)=>({id:'upkeep-ai-'+i})),
    deck:[{id:'upkeep-ai-final-deck-card'}],
    units:[unit('neutral-upkeep-unit',{
      name:'무속성 유지비 유닛',
      cost:{forest:1,neutral:1},
      costKnown:true,
      costMapped:true
    })],
    lands:[]
  });
  const s=state(p,ai,{
    round:4,
    attackerId:'player',
    activeId:'player',
    prepared:{player:false,ai:false}
  });

  const result=FM.endPhase(s,'player');

  assert.equal(result.ok,true);
  assert.equal(ai.neutralUpkeep,1,'the unit requires one neutral upkeep soul each preparation phase');
  assert.equal(ai.deck.length,0,'the unpaid upkeep destroys the final card in the AI deck');
  assert.equal(s.status,'finished');
  assert.equal(s.result,'player','the player wins when the AI upkeep exhausts its deck');
  assert.equal(ai.hand.length,5,'AI hand refill is skipped after upkeep already finished the match');
  assert.equal(s.round,4,'the upkeep terminal result does not advance the round');
  assert.ok(!s.log.some(entry=>entry.text.includes('카드를 검토하고 있습니다.')),
    'AI auto-play must not begin after upkeep has ended the match');
  assert.ok(s.log.some(entry=>entry.text.includes('무속성 소울 유지비 1')));
  assert.ok(s.log.some(entry=>entry.text.includes(ai.name+'의 서고가 소진되었습니다.')));
});

test('LP accumulates each turn and a land placement consumes LP only',()=>{
  const p=player('player',{hand:[{...land('high-lp','light',2,2),instanceId:'l1'}],
    lp:2,soulPool:{colored:{forest:1},neutral:0}});
  const ai=player('ai');
  const s=state(p,ai);
  assert.equal(FM.playCard(s,'player','l1').ok,true);
  assert.equal(p.lp,0);
  assert.equal(p.lands.length,1);
  assert.equal(p.soulPool.colored.light,1);
  assert.equal(p.soulPool.neutral,2);
  assert.equal(FM.playCard(s,'player','l1').ok,false);
});


test('terrain installation spends LP and the exact RequireSoul cost before adding production',()=>{
  const card={id:'paid-land',instanceId:'lu',name:'구름도시',type:'land',
    faction:'light',requiredLP:2,requiredLPKnown:true,
    landInstallCost:{light:1,neutral:1},landInstallCostKnown:true,soulProductionStatus:'source-decoded',
    soulProduction:{colored:{light:1},neutral:0}};
  const p=player('player',{hand:[card],lp:2,soulPool:{colored:{light:1,fire:1},neutral:1}});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','lu');
  assert.equal(result.ok,true);
  assert.equal(p.hand.length,0);
  assert.equal(p.lp,0);
  assert.equal(p.soulPool.colored.fire,1);
  assert.equal(p.soulPool.colored.light,1);
  assert.equal(p.soulPool.neutral,0);
  assert.equal(p.lands.length,1);
});

test('terrain with insufficient install soul cannot consume LP or leave the hand',()=>{
  const card={id:'paid-land',instanceId:'lu',name:'구름도시',type:'land',
    faction:'light',requiredLP:2,requiredLPKnown:true,
    landInstallCost:{light:1,neutral:1},landInstallCostKnown:true,soulProductionStatus:'source-decoded',
    soulProduction:{colored:{light:1},neutral:0}};
  const initialPool={colored:{light:0,fire:1},neutral:0};
  const p=player('player',{hand:[card],lp:2,soulPool:initialPool});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','lu');
  assert.equal(result.ok,false);
  assert.match(result.reason,/지형 설치 소울이 부족/);
  assert.equal(p.lp,2);
  assert.equal(p.hand.length,1);
  assert.deepEqual(p.soulPool,initialPool);
});

test('MagicLand installs without inventing ordinary production while its effect remains pending',()=>{
  const card={id:'magic-land',instanceId:'ml',name:'빛의성벽',type:'land',
    requiredLP:0,requiredLPKnown:true,landInstallCost:{neutral:0},landInstallCostKnown:true,
    soulProduction:{colored:{},neutral:0},soulProductionStatus:'magicland-effect',
    runtimeLandProductionStatus:'fallback_noop',isMagicLand:true};
  const p=player('player',{hand:[card],lp:1,soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','ml');
  assert.equal(result.ok,true);
  assert.equal(p.lp,1);
  assert.equal(p.hand.length,0);
  assert.equal(p.lands.length,1);
  assert.equal(p.soulPool.neutral,0);
});

test('terrain LP is spent while its colored and neutral souls are added to the pool',()=>{
  const card={...land('paid-land','light',2,2),instanceId:'paid1'};
  const p=player('player',{hand:[card],lp:2,soulPool:{colored:{fire:2},neutral:1}});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','paid1').ok,true);
  assert.equal(p.lp,0);
  assert.equal(p.soulPool.colored.fire,2);
  assert.equal(p.soulPool.colored.light,1);
  assert.equal(p.soulPool.neutral,3);
  assert.equal(p.lands.length,1);
});

test('LP accumulates but only one land can be installed per preparation phase; field cap stays ten',()=>{
  const first={...land('first','forest',1,0),instanceId:'l1'};
  const second={...land('second','fire',1,0),instanceId:'l2'};
  const p=player('player',{hand:[first,second],lp:2});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','l1').ok,true);
  assert.equal(p.lp,1);
  const blocked=FM.playCard(s,'player','l2');
  assert.equal(blocked.ok,false);
  assert.match(blocked.reason,/한 준비 단계에는 지형을 1장/);
  assert.equal(p.lands.length,1);

  FM._test.beginPhase(s,'player');
  assert.equal(p.lp,2);
  assert.equal(FM.playCard(s,'player','l2').ok,true);
  assert.equal(p.lp,1);
  assert.equal(p.lands.length,2);
  assert.equal(p.unitDeployLimit,2);

  p.lands=Array.from({length:10},(_,i)=>land('field'+i,'forest'));
  p.hand=[{...land('eleventh','forest'),instanceId:'l11'}];
  p.playedLand=false;p.lp=5;
  const capped=FM.playCard(s,'player','l11');
  assert.equal(capped.ok,false);
  assert.match(capped.reason,/최대 10장/);
});

test('colored and generic soul requirements consume a pool, not whole land cards',()=>{
  const p=player('player',{lands:[land('forest','forest'),land('fire','fire')],
    soulPool:{colored:{forest:1,fire:1},neutral:0}});
  assert.equal(FM.canPay(p,{forest:1,neutral:1}),true);
  assert.equal(FM.spendSoul(p,{forest:1,neutral:1}),true);
  assert.equal(Object.values(p.soulPool.colored).reduce((sum,n)=>sum+n,0)+p.soulPool.neutral,0);
  assert.equal(p.lands.length,2);
});

test('a generic neutral bead can be paid from any generated soul',()=>{
  const p=player('player',{soulPool:{colored:{light:2},neutral:0}});
  assert.equal(FM.canPay(p,{neutral:2}),true);
  assert.equal(FM.spendSoul(p,{neutral:1}),true);
  assert.equal(p.soulPool.colored.light,1);
  assert.equal(Object.values(p.soulPool.colored).reduce((sum,n)=>sum+n,0)+p.soulPool.neutral,1);
});

test('neutral soul upkeep is charged only for neutral summon beads',()=>{
  const p=player('player',{
    units:[unit('colored-unit',{cost:{forest:2}}),unit('neutral-unit',{cost:{neutral:2}})],
    lands:[land('light-land','light',1,1),land('fire-land','fire',1,1)],
    hand:Array.from({length:6},(_,i)=>({id:'h'+i})),
    deck:Array.from({length:8},(_,i)=>({id:'d'+i}))
  });
  const ai=player('ai',{hand:Array.from({length:6},(_,i)=>({id:'ah'+i}))});
  const s=state(p,ai);
  FM._test.beginPhase(s,'player');
  assert.equal(p.neutralUpkeep,2);
  assert.equal(p.deck.length,8);
  assert.equal(Object.values(p.soulPool.colored).reduce((sum,n)=>sum+n,0)+p.soulPool.neutral,2);
});

test('unpaid neutral upkeep destroys exactly the missing number of deck cards',()=>{
  const p=player('player',{
    units:[unit('neutral-unit',{cost:{neutral:3}})],
    lands:[land('one-soul','fire',1,0)],
    hand:Array.from({length:6},(_,i)=>({id:'h'+i})),
    deck:Array.from({length:6},(_,i)=>({id:'d'+i}))
  });
  const ai=player('ai',{hand:Array.from({length:6},(_,i)=>({id:'ah'+i}))});
  const s=state(p,ai);
  FM._test.beginPhase(s,'player');
  assert.equal(p.neutralUpkeep,3);
  assert.equal(p.deck.length,4);
  assert.equal(Object.values(p.soulPool.colored).reduce((sum,n)=>sum+n,0)+p.soulPool.neutral,0);
  assert.ok(s.log.some(x=>x.text.includes('2장을 파괴')));
});

test('unit deployment spends colored soul and leaves unused soul in the pool',()=>{
  const card={...unit('scout'),instanceId:'u1',cost:{forest:1}};
  const p=player('player',{hand:[card],lands:[land('forest','forest')],
    soulPool:{colored:{forest:2},neutral:0},unitDeployLimit:2});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','u1');
  assert.equal(result.ok,true);
  assert.equal(p.units.length,1);
  assert.equal(p.hand.length,0);
  assert.equal(p.soulPool.colored.forest,1);
});

test('item attaches only to a unit with a matching native unit ability',()=>{
  const item={id:'item',instanceId:'i1',name:'검',type:'item',cost:{forest:0},costKnown:true,costMapped:true,
    allowedUnitAbilities:['장비'],apBonus:1};
  const mage=unit('mage',{instanceId:'m1',unitAbility:'마법',unitAbilityTags:['마법']});
  const gear=unit('gear',{instanceId:'g1',unitAbility:'장비',unitAbilityTags:['장비']});
  const p=player('player',{hand:[item],units:[mage,gear],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','i1').ok,false);
  assert.equal(FM.playCard(s,'player','i1','m1').ok,false);
  assert.equal(FM.playCard(s,'player','i1','g1').ok,true);
  assert.equal(gear.itemAP,1);
});


test('item with unrestricted ability still requires matching native target race',()=>{
  const item={id:'bird-item',instanceId:'bird1',name:'새 부리',type:'item',cost:{forest:0},costKnown:true,costMapped:true,
    allowedUnitAbilities:['만능'],itemConditions:{owner:'own',race:'버드',affiliation:null,unsupported:[],mapped:true}};
  const human=unit('human',{instanceId:'h1',race:'마스터'});
  const bird=unit('bird',{instanceId:'b1',race:'버드'});
  const p=player('player',{hand:[item],units:[human,bird],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','bird1','h1').ok,false);
  assert.equal(FM.playCard(s,'player','bird1','b1').ok,true);
});

test('item with unrestricted ability still requires matching native affiliation',()=>{
  const item={id:'clan-item',instanceId:'clan1',name:'클랜 도끼',type:'item',cost:{forest:0},costKnown:true,costMapped:true,
    allowedUnitAbilities:['만능'],itemConditions:{owner:'own',race:null,affiliation:'라티노반',unsupported:[],mapped:true}};
  const other=unit('other',{instanceId:'o1',affiliation:'다른 소속'});
  const member=unit('member',{instanceId:'m1',affiliation:'라티노반'});
  const p=player('player',{hand:[item],units:[other,member],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','clan1','o1').ok,false);
  assert.equal(FM.playCard(s,'player','clan1','m1').ok,true);
});

test('unparsed native item target restrictions use deterministic any-unit fallback',()=>{
  const item={id:'unknown-item',instanceId:'unknown1',name:'조건 미해석 아이템',type:'item',
    cost:{forest:0},costKnown:true,costMapped:true,runtimeItemConditionStatus:'fallback_any_unit',
    allowedUnitAbilities:['만능'],itemConditions:{owner:'own',race:null,affiliation:null,unsupported:['race'],mapped:false}};
  const target=unit('target',{instanceId:'t1',race:'버드'});
  const p=player('player',{hand:[item],units:[target],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','unknown1','t1');
  assert.equal(result.ok,true);
  assert.equal(p.hand.length,0);
  assert.equal(target.equipment.includes('조건 미해석 아이템'),true);
});

test('successful unit summon emits one source-linked event after the field commit',()=>{
  const card=unit('summon-card',{instanceId:'hand-unit',cost:{forest:0},costKnown:true,costMapped:true});
  const p=player('player',{hand:[card],unitDeployLimit:1,soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  s.combatEventQueue=FM._test.createCombatEventQueue();
  const dispatcher=FM._test.createCombatEventDispatcher();
  FM._test.attachCombatEventDispatcher(s,dispatcher);
  const seen=[];
  dispatcher.register({ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_summoned']},event=>{seen.push(event);return true;});
  const result=FM.playCard(s,'player','hand-unit');
  assert.equal(result.ok,true);
  assert.equal(p.units.length,1);
  assert.equal(seen.length,1);
  const event=seen[0];
  assert.equal(event.type,'unit_summoned');
  assert.equal(event.ownerId,'player');
  assert.equal(event.cause,'play_card');
  assert.equal(event.sourceCardId,'summon-card');
  assert.equal(event.targetInstanceId,p.units[0].instanceId);
  assert.equal(event.fieldIndex,0);
  assert.equal(event.payload.slotIndex,1);
  assert.equal(event.snapshot.unit.cardId,'summon-card');
  assert.equal(s.combatEventQueue.size(),0);
});

test('failed unit summon emits no unit_summoned event and leaves the hand unchanged',()=>{
  const card=unit('summon-blocked',{instanceId:'blocked-unit',cost:{forest:1},costKnown:true,costMapped:true});
  const p=player('player',{hand:[card],unitDeployLimit:1,soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  s.combatEventQueue=FM._test.createCombatEventQueue();
  const dispatcher=FM._test.createCombatEventDispatcher();
  FM._test.attachCombatEventDispatcher(s,dispatcher);
  const seen=[];
  dispatcher.register({ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_summoned']},event=>{seen.push(event);return true;});
  const result=FM.playCard(s,'player','blocked-unit');
  assert.equal(result.ok,false);
  assert.equal(p.hand.length,1);
  assert.equal(p.units.length,0);
  assert.equal(seen.length,0);
  assert.equal(s.combatEventQueue.size(),0);
});


test('successful terrain installation emits a source-linked event only after LP, cost and production commit',()=>{
  const card={...land('event-land','light',2,2),instanceId:'event-land-1'};
  const p=player('player',{hand:[card],lp:2,soulPool:{colored:{forest:1},neutral:0}});
  const s=state(p,player('ai'));
  s.combatEventQueue=FM._test.createCombatEventQueue();
  const dispatcher=FM._test.createCombatEventDispatcher();
  FM._test.attachCombatEventDispatcher(s,dispatcher);
  const seen=[];
  dispatcher.register({ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['land_installed']},event=>seen.push(event));
  const result=FM.playCard(s,'player','event-land-1');
  assert.equal(result.ok,true);
  assert.equal(p.lands.length,1);
  assert.equal(p.lp,0);
  assert.equal(p.soulPool.colored.light,1);
  assert.equal(p.soulPool.neutral,2);
  assert.equal(seen.length,1);
  assert.equal(seen[0].type,'land_installed');
  assert.equal(seen[0].sourceCardId,'event-land');
  assert.equal(seen[0].targetInstanceId,'event-land-1');
  assert.equal(seen[0].fieldIndex,0);
  assert.equal(seen[0].payload.requiredLP,2);
  assert.deepEqual(seen[0].payload.production,{colored:{light:1},neutral:2});
  assert.equal(s.combatEventQueue.size(),0);
});

test('failed terrain installation emits no event and preserves the original hand and resources',()=>{
  const card={...land('event-land-blocked','light',2,0),instanceId:'event-land-blocked-1'};
  const p=player('player',{hand:[card],lp:1,soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  s.combatEventQueue=FM._test.createCombatEventQueue();
  const dispatcher=FM._test.createCombatEventDispatcher();
  FM._test.attachCombatEventDispatcher(s,dispatcher);
  const seen=[];
  dispatcher.register({ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['land_installed']},event=>seen.push(event));
  assert.equal(FM.playCard(s,'player','event-land-blocked-1').ok,false);
  assert.equal(p.hand.length,1);
  assert.equal(p.lp,1);
  assert.equal(p.lands.length,0);
  assert.equal(seen.length,0);
  assert.equal(s.combatEventQueue.size(),0);
});

test('successful item equip emits target and stat payload after the equipment commit',()=>{
  const target=unit('event-target',{instanceId:'event-target-1'});
  const item={id:'event-item',instanceId:'event-item-1',name:'강화검',type:'item',
    cost:{forest:0},costKnown:true,costMapped:true,allowedUnitAbilities:['장비'],apBonus:2,dpBonus:1,hpBonus:0};
  const p=player('player',{hand:[item],units:[target],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  s.combatEventQueue=FM._test.createCombatEventQueue();
  const dispatcher=FM._test.createCombatEventDispatcher();
  FM._test.attachCombatEventDispatcher(s,dispatcher);
  const seen=[];
  dispatcher.register({ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['item_equipped']},event=>seen.push(event));
  assert.equal(FM.playCard(s,'player','event-item-1','event-target-1').ok,true);
  assert.equal(FM.totalPower(target,'ap'),5);
  assert.equal(FM.totalPower(target,'dp'),3);
  assert.equal(seen.length,1);
  assert.equal(seen[0].type,'item_equipped');
  assert.equal(seen[0].sourceCardId,'event-item');
  assert.equal(seen[0].targetInstanceId,'event-target-1');
  assert.deepEqual(seen[0].payload,{targetOwnerId:'player',apBonus:2,dpBonus:1,hpBonus:0,grantsSpecialSkill:null});
  assert.equal(s.combatEventQueue.size(),0);
});

test('failed item targeting emits no equipment event and leaves item in hand',()=>{
  const item={id:'event-item',instanceId:'event-item-1',name:'강화검',type:'item',
    cost:{forest:0},costKnown:true,costMapped:true,apBonus:2};
  const p=player('player',{hand:[item],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  s.combatEventQueue=FM._test.createCombatEventQueue();
  const dispatcher=FM._test.createCombatEventDispatcher();
  FM._test.attachCombatEventDispatcher(s,dispatcher);
  const seen=[];
  dispatcher.register({ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['item_equipped']},event=>seen.push(event));
  assert.equal(FM.playCard(s,'player','event-item-1','missing-target').ok,false);
  assert.equal(p.hand.length,1);
  assert.equal(seen.length,0);
  assert.equal(s.combatEventQueue.size(),0);
});

test('successful spell queue emits a source-linked event after slot assignment',()=>{
  const spell={id:'event-spell',instanceId:'event-spell-1',name:'화살',type:'spell',
    cost:{forest:0},costKnown:true,costMapped:true,triggerTiming:'공격턴',effect:{type:'draw',amount:1}};
  const p=player('player',{hand:[spell],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  s.combatEventQueue=FM._test.createCombatEventQueue();
  const dispatcher=FM._test.createCombatEventDispatcher();
  FM._test.attachCombatEventDispatcher(s,dispatcher);
  const seen=[];
  dispatcher.register({ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['spell_queued']},event=>seen.push(event));
  assert.equal(FM.playCard(s,'player','event-spell-1').ok,true);
  assert.equal(p.spells.length,1);
  assert.equal(seen.length,1);
  assert.equal(seen[0].type,'spell_queued');
  assert.equal(seen[0].sourceCardId,'event-spell');
  assert.equal(seen[0].targetInstanceId,null);
  assert.equal(seen[0].fieldIndex,0);
  assert.equal(seen[0].payload.slotIndex,1);
  assert.equal(seen[0].payload.triggerTiming,'공격턴');
  assert.equal(s.combatEventQueue.size(),0);
});

test('failed spell target validation emits no queue event and preserves the hand',()=>{
  const spell={id:'event-spell',instanceId:'event-spell-1',name:'화살',type:'spell',
    cost:{forest:0},costKnown:true,costMapped:true,triggerTiming:'공격턴',
    effect:{type:'damage',target:'enemyUnit',amount:1}};
  const p=player('player',{hand:[spell],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  s.combatEventQueue=FM._test.createCombatEventQueue();
  const dispatcher=FM._test.createCombatEventDispatcher();
  FM._test.attachCombatEventDispatcher(s,dispatcher);
  const seen=[];
  dispatcher.register({ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['spell_queued']},event=>seen.push(event));
  assert.equal(FM.playCard(s,'player','event-spell-1').ok,false);
  assert.equal(p.hand.length,1);
  assert.equal(p.spells.length,0);
  assert.equal(seen.length,0);
  assert.equal(s.combatEventQueue.size(),0);
});

test('a spell is queued in its magic slot and resolves only in battle',()=>{
  const spell={id:'spell',instanceId:'s1',name:'화살',type:'spell',cost:{forest:0},costKnown:true,costMapped:true,
    triggerTiming:'공격/방어',durationTurns:1,effect:{type:'damage',target:'enemyUnit',amount:3}};
  const p=player('player',{hand:[spell],soulPool:{colored:{},neutral:0}});
  const target=unit('target',{instanceId:'t1',hp:2,maxHp:2,cost:{fire:1}});
  const ai=player('ai',{units:[target]});
  const s=state(p,ai);
  assert.equal(FM.playCard(s,'player','s1','t1').ok,true);
  assert.equal(p.spells.length,1);
  assert.equal(ai.units.length,1);
  FM.resolveBattle(s);
  assert.equal(ai.units.length,0);
  assert.equal(p.spells.length,0);
  assert.equal(p.graveyard[0].id,'spell');
});

test('unit slot combat is paired 1:1 with shared AP/DP/HP rolls and surviving HP resets after battle',()=>{
  const attacker=unit('attacker',{instanceId:'a1',ap:4,dp:1,hp:3,maxHp:3,cost:{forest:1}});
  const defender=unit('defender',{instanceId:'d1',ap:2,dp:2,hp:6,maxHp:6,cost:{fire:2}});
  const p=player('player',{units:[attacker],deck:[{id:'p'}]});
  const ai=player('ai',{units:[defender],deck:[{id:'d'}],hand:Array.from({length:6},(_,i)=>({id:'ah'+i}))});
  const s=state(p,ai,{activeId:'ai',prepared:{player:true,ai:true}});
  FM.resolveBattle(s);
  assert.equal(attacker.hp,3);
  assert.equal(defender.hp,6);
  assert.equal(s.round,2);
  assert.equal(s.attackerId,'ai');
});

test('an unblocked unit attacks the deck using its printed soul cost',()=>{
  const attacker=unit('attacker',{instanceId:'a1',ap:9,cost:{forest:2,neutral:1}});
  const p=player('player',{units:[attacker],deck:[{id:'p'}]});
  const ai=player('ai',{units:[],deck:Array.from({length:10},(_,i)=>({id:'d'+i})),
    hand:Array.from({length:6},(_,i)=>({id:'ah'+i}))});
  const s=state(p,ai,{activeId:'ai',prepared:{player:true,ai:true}});
  FM.resolveBattle(s);
  assert.equal(ai.deck.length,7);
});

test('FM1 defense-bypass attack deals AP directly to HP without subtracting DP',()=>{
  const attacker=unit('attacker',{instanceId:'a1',ap:3,skill:'방어무시'});
  const defender=unit('defender',{instanceId:'d1',dp:5,hp:7,maxHp:7});
  const p=player('player'),ai=player('ai'),s=state(p,ai);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender);
  assert.equal(defender.hp,4);
});

test('FM1 shared coin toss is rolled once and reused for AP and DP',()=>{
  const u=unit('coin-unit',{ap:3,dp:4,coinTech:{sharedTosses:1,stats:{
    ap:{coin:[{operation:'add',multiplier:2,tosses:1}]},
    dp:{coin:[{operation:'subtract',multiplier:1,tosses:1}]}
  }}});
  let calls=0;
  const profile=FM._test.coinProfile(u,()=>{calls++;return 0.9;});
  const ap=FM._test.rollStat(u,'ap',()=>{throw new Error('should reuse shared roll');},profile);
  const dp=FM._test.rollStat(u,'dp',()=>{throw new Error('should reuse shared roll');},profile);
  assert.equal(calls,1);
  assert.equal(ap.value,5);
  assert.equal(dp.value,3);
});

test('FM1 unsigned 2C3 replaces the stat while +2C3 adds the same coin result',()=>{
  const setUnit=unit('set-coin-unit',{ap:3,coinTech:{sharedTosses:3,stats:{
    ap:{coin:[{operation:'set',multiplier:2,tosses:3}]}
  }}});
  const addUnit=unit('add-coin-unit',{ap:3,coinTech:{sharedTosses:3,stats:{
    ap:{coin:[{operation:'add',multiplier:2,tosses:3}]}
  }}});
  const setRoll=FM._test.rollStat(setUnit,'ap',()=>0.9);
  const addRoll=FM._test.rollStat(addUnit,'ap',()=>0.9);
  assert.equal(setRoll.count,3);
  assert.equal(setRoll.heads,3);
  assert.equal(setRoll.value,6);
  assert.equal(addRoll.value,9);
});

test('FM1 negative DP from coin subtraction is preserved',()=>{
  const u=unit('negative-dp',{dp:0,coinTech:{sharedTosses:1,stats:{
    dp:{coin:[{operation:'subtract',multiplier:1,tosses:1}]}
  }}});
  const roll=FM._test.rollStat(u,'dp',()=>0.9);
  assert.equal(roll.value,-1);
});

test('FM1 intimidation taunt leaves target at 1 HP and transfers lost HP to its AP',()=>{
  const attacker=unit('taunter',{instanceId:'a1',ap:3,skill:'조롱공격기술'});
  const defender=unit('target',{instanceId:'d1',ap:2,dp:1,hp:10,maxHp:10});
  const p=player('player'),ai=player('ai'),s=state(p,ai);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender);
  assert.equal(defender.hp,1);
  assert.equal(FM.totalPower(defender,'ap'),9);
});

test('FM1 suppression permanently converts target special attack to ordinary attack',()=>{
  const attacker=unit('sealer',{instanceId:'a1',ap:1,skill:'봉쇄공격'});
  const defender=unit('target',{instanceId:'d1',ap:4,dp:1,hp:9,maxHp:9,skill:'방어무시'});
  const p=player('player'),ai=player('ai'),s=state(p,ai);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender);
  assert.equal(defender.skill,'일반공격기술');
  assert.equal(defender.tempSkill,null);
});

test('FM1 petrification sets target AP to zero and raises DP by one',()=>{
  const attacker=unit('petrifier',{instanceId:'a1',ap:1,skill:'석화공격'});
  const defender=unit('target',{instanceId:'d1',ap:4,dp:2,hp:9,maxHp:9});
  const p=player('player'),ai=player('ai'),s=state(p,ai);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender);
  assert.equal(FM.totalPower(defender,'ap'),0);
  assert.equal(FM.totalPower(defender,'dp'),3);
});

test('both players running out of deck at once makes the attacker lose',()=>{
  const p=player('player',{deck:[]});
  const ai=player('ai',{deck:[]});
  const s=state(p,ai,{attackerId:'player'});
  assert.equal(FM.checkWinner(s),true);
  assert.equal(s.result,'ai');
});

test('AI completes its preparation phase, installs land, deploys a unit and yields to the player',()=>{
  const lands=Array.from({length:10},(_,i)=>land('ai-land'+i,'forest'));
  const units=Array.from({length:24},(_,i)=>unit('ai-unit'+i));
  const spells=Array.from({length:16},(_,i)=>({id:'ai-spell'+i,name:'AI 마법',type:'spell',
    faction:'forest',cost:{forest:1},effect:{type:'draw',amount:1}}));
  const cards=lands.concat(units,spells);
  const game=FM.newGame({cards,playerDeck:cards,aiDeck:cards,rng:()=>0.31});
  game.activeId='ai';
  FM._test.beginPhase(game,'ai');
  FM.runAIPhase(game,'ai');
  assert.equal(game.prepared.ai,true);
  assert.ok(game.players.ai.lands.length>0,'AI should install an affordable land');
  assert.ok(game.players.ai.units.length>0,'AI should deploy a unit after its land generates soul');
  assert.equal(game.players.ai.playedAnyCardThisPhase,true);
});


test('a unit cannot be deployed more times than terrain-generated souls allow in one prep phase',()=>{
  const a={...unit('unit-a'),instanceId:'ua'};
  const b={...unit('unit-b'),instanceId:'ub'};
  const p=player('player',{hand:[a,b],soulPool:{colored:{forest:2},neutral:0},
    unitDeployLimit:1,units:[],unitDeployedThisPhase:0});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','ua').ok,true);
  const blocked=FM.playCard(s,'player','ub');
  assert.equal(blocked.ok,false);
  assert.match(blocked.reason,/지형이 생성한 소울 수/);
  assert.equal(p.units.length,1);
  assert.equal(p.hand.length,1);
});

test('runtime cost overlay allows inferred BONUS payment while source review remains visible',()=>{
  const card={...unit('overlay'),instanceId:'overlay-1',cost:{},costKnown:false,costMapped:false,
    runtimeCost:{forest:1,neutral:1},runtimeCostKnown:true,runtimeCostStatus:'implemented_inferred'};
  const p=player('player',{hand:[card],soulPool:{colored:{forest:1,metal:1},neutral:0},unitDeployLimit:10});
  const result=FM.playCard(state(p,player('ai')),'player','overlay-1');
  assert.equal(result.ok,true);
  assert.equal(p.soulPool.colored.forest,0);
  assert.equal(p.soulPool.colored.metal,0);
});

test('unverified source cost receives a payable conservative runtime fallback, never a free cost',()=>{
  const card={...unit('unverified'),instanceId:'unverified-1',cost:{forest:0},costKnown:false,costMapped:false};
  const p=player('player',{hand:[card],soulPool:{colored:{forest:10},neutral:10},unitDeployLimit:10});
  const result=FM.playCard(state(p,player('ai')),'player','unverified-1');
  assert.equal(result.ok,true);
  assert.equal(p.soulPool.neutral,9);
  assert.equal(p.units.length,1);
  assert.equal(p.hand.length,0);
});

test('stat markers block changes in the protected direction',()=>{
  const immutable=unit('fixed',{statMarkers:{ap:'*'}});
  const noDecrease=unit('up-only',{statMarkers:{ap:'▲'}});
  const noIncrease=unit('down-only',{statMarkers:{ap:'▼'}});
  assert.equal(FM._test.changeUnitStat(immutable,'ap',2),false);
  assert.equal(FM._test.changeUnitStat(noDecrease,'ap',-2),false);
  assert.equal(FM._test.changeUnitStat(noDecrease,'ap',2),true);
  assert.equal(FM.totalPower(noDecrease,'ap'),5);
  assert.equal(FM._test.changeUnitStat(noIncrease,'ap',2),false);
  assert.equal(FM._test.changeUnitStat(noIncrease,'ap',-2),true);
  assert.equal(FM.totalPower(noIncrease,'ap'),1);
});

test('FM1 reshuffle is available once per turn in the first four turns and burns one card',()=>{
  const p=player('player',{hand:Array.from({length:6},(_,i)=>({id:'h'+i})),
    deck:Array.from({length:20},(_,i)=>({id:'d'+i})),reshuffleUsedRound:0});
  const s=state(p,player('ai'),{round:1});
  const before=p.deck.length;
  const result=FM.reshuffleHand(s,'player');
  assert.equal(result.ok,true);
  assert.equal(p.reshuffleUsedRound,1);
  assert.equal(p.graveyard.length,1);
  assert.equal(p.hand.length,6);
  assert.equal(p.deck.length,before-1);
  assert.equal(FM.reshuffleHand(s,'player').ok,false);
});

test('FM1 reshuffle is disabled after a card was placed and after turn four',()=>{
  const p=player('player',{hand:[{id:'h1'}],deck:[{id:'d1'}],playedAnyCardThisPhase:true});
  const s=state(p,player('ai'),{round:1});
  assert.equal(FM.reshuffleHand(s,'player').ok,false);
  p.playedAnyCardThisPhase=false;
  s.round=5;
  assert.equal(FM.reshuffleHand(s,'player').ok,false);
});

test('terrain with an explicitly verified zero install-soul cost consumes LP and produces souls',()=>{
  const card={...land('lp-only-land','light',1,0),instanceId:'lp-only',
    landInstallCost:{neutral:0},landInstallCostKnown:true};
  const p=player('player',{hand:[card],lp:1,soulPool:{colored:{fire:1,light:0},neutral:1}});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','lp-only').ok,true);
  assert.equal(p.lp,0);
  assert.equal(p.soulPool.colored.fire,1);
  assert.equal(p.soulPool.neutral,1);
  assert.equal(p.soulPool.colored.light,1);
  assert.equal(p.unitDeployLimit,3);
});

test('fractional dual-colour production is preserved and deployment limit rounds down',()=>{
  const output=FM._test.productionOf({soulProduction:{colored:{light:0.5,earth:1.5},neutral:0.25}});
  assert.deepEqual(output,{colored:{light:0.5,earth:1.5},neutral:0.25});
  const card={id:'fractional-land',instanceId:'fractional',name:'소수 지형',type:'land',
    requiredLP:1,requiredLPKnown:true,souls:['light','earth'],
    soulProduction:{colored:{light:0.5,earth:1.5},neutral:0.25},soulProductionStatus:'source-decoded',
    landInstallCost:{neutral:0},landInstallCostKnown:true};
  const p=player('player',{hand:[card],lp:1});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','fractional').ok,true);
  assert.equal(p.unitDeployLimit,2);
});

test('battle-start spell timing is accepted for both sides',()=>{
  const p=player('player',{spells:[{id:'start-spell',instanceId:'start-spell',slotIndex:1,
    triggerTiming:'전투 시작시',effect:{type:'draw',amount:1,target:'ownDeck'},durationTurns:0}]});
  const s=state(p,player('ai'));
  assert.equal(FM._test.resolveSpellSlot(s,'player',1),true);
  assert.equal(p.spells.length,0);
});


test('FM1 manual special attacks apply their named stat conditions',()=>{
  const run=(skill,aExtra={},dExtra={},rollExtra={})=>{
    const a=unit('a',{instanceId:'a',skill,...aExtra});
    const d=unit('d',{instanceId:'d',...dExtra});
    const p=player('player',{units:[a]}),ai=player('ai',{units:[d]}),s=state(p,ai);
    const rolls={
      attacker:{ap:{value:a.ap},dp:{value:a.dp},hp:{value:a.maxHp}},
      defender:{ap:{value:d.ap},dp:{value:d.dp},hp:{value:d.maxHp}}
    };
    for(const side of ['attacker','defender'])for(const stat of ['ap','dp','hp'])
      if(rollExtra[side]?.[stat]!==undefined)rolls[side][stat].value=rollExtra[side][stat];
    const result=FM._test.resolveUnitAttack(s,p,ai,a,d,rolls);
    return {a,d,rolls,result};
  };

  let x=run('방어무시공격기술',{ap:2},{dp:5,hp:10});
  assert.equal(x.d.hp,8);
  x=run('관통공격기술',{ap:4},{dp:3,hp:10});
  assert.equal(FM.totalPower(x.d,'dp'),0);assert.equal(x.d.hp,9);
  x=run('치명공격기술',{ap:1},{dp:5,hp:10});
  assert.equal(x.d.hp,1);
  x=run('돌진공격기술',{ap:2,dp:3},{dp:1,hp:10});
  assert.equal(x.d.hp,6);
  x=run('약화공격기술',{ap:1},{ap:4,dp:2,hp:10});
  assert.equal(FM.totalPower(x.d,'ap'),3);assert.equal(FM.totalPower(x.d,'dp'),1);
  x=run('석화공격기술',{ap:1},{ap:4,dp:2,hp:10});
  assert.equal(FM.totalPower(x.d,'ap'),0);assert.equal(FM.totalPower(x.d,'dp'),3);
  x=run('흡혈공격기술',{ap:3,hp:2,maxHp:5},{dp:0,hp:10});
  assert.equal(x.a.hp,4);
  x=run('노화공격기술',{ap:1},{ap:4,dp:0,hp:10});
  assert.equal(FM.totalPower(x.d,'ap'),2);
  x=run('야수조련공격기술',{ap:1},{ap:4,dp:0,hp:10,unitAbility:'야수능력',unitAbilityTags:['야수']});
  assert.equal(FM.totalPower(x.d,'ap'),0);
  x=run('용맹공격기술',{ap:0,level:5},{dp:5,hp:10,level:4});
  assert.equal(x.d.hp,10);
  x=run('재생공격기술',{ap:1,hp:2,maxHp:5},{dp:5,hp:10});
  assert.equal(x.a.hp,3);
  x=run('광분공격기술',{ap:3,hp:5,maxHp:5},{dp:1,hp:10});
  assert.equal(x.a.hp,1);assert.equal(x.d.hp,4);
  x=run('연속공격기술',{ap:3},{dp:1,hp:10});
  assert.equal(x.d.hp,7);
  x=run('공포공격기술',{ap:0,level:3},{dp:5,hp:10,level:4});
  assert.equal(x.d.hp,10);
  x=run('매료공격기술',{ap:1},{dp:3,hp:10,ap:4});
  assert.equal(FM.totalPower(x.d,'ap'),0);
  x=run('마법봉쇄공격기술',{ap:1},{ap:4,dp:0,hp:10,unitAbility:'마법능력',unitAbilityTags:['마법']});
  assert.equal(FM.totalPower(x.d,'ap'),0);
  x=run('무기뺏기공격기술',{ap:1},{ap:4,dp:0,hp:10,unitAbility:'장비능력',unitAbilityTags:['장비']});
  assert.equal(FM.totalPower(x.d,'ap'),0);
  x=run('복제공격기술',{ap:1},{ap:4,dp:1,hp:10},{defender:{ap:5}});
  assert.equal(x.d.hp,6);
  x=run('방패파괴공격기술',{ap:1},{dp:3,hp:10});
  assert.equal(FM.totalPower(x.d,'dp'),0);
  x=run('저주공격기술',{ap:1},{ap:4,dp:3,hp:10});
  assert.equal(FM.totalPower(x.d,'ap'),2);assert.equal(FM.totalPower(x.d,'dp'),1);
  x=run('방어이용공격기술',{ap:2},{dp:3,hp:10});
  assert.equal(x.d.hp,5);
  x=run('조롱공격기술',{ap:1},{ap:2,dp:0,hp:10});
  assert.equal(x.d.hp,1);assert.equal(FM.totalPower(x.d,'ap'),10);
  x=run('혼란공격기술',{ap:1},{ap:3,dp:0,hp:5,maxHp:5});
  assert.equal(FM.totalPower(x.d,'ap'),5);assert.equal(x.d.hp,2);
  x=run('은폐공격기술',{ap:1,dp:2},{dp:0,hp:10});
  assert.equal(FM.totalPower(x.a,'dp'),3);
  x=run('방어전환공격기술',{ap:1},{dp:3,hp:10});
  assert.equal(FM.totalPower(x.d,'dp'),-3);
});


test('Manual bravery/fear use the defender level relation and add AP before DP even at AP zero',()=>{
  const run=(skill,attackerLevel,defenderLevel)=>{
    const a=unit('rank-attacker',{instanceId:'rank-a',skill,ap:0,dp:0,hp:10,maxHp:10,level:attackerLevel});
    const d=unit('rank-defender',{instanceId:'rank-d',ap:0,dp:0,hp:10,maxHp:10,level:defenderLevel});
    const p=player('player',{units:[a]}),ai=player('ai',{units:[d]}),st=state(p,ai);
    FM._test.resolveUnitAttack(st,p,ai,a,d,{
      attacker:{ap:{value:0},dp:{value:0},hp:{value:10}},
      defender:{ap:{value:0},dp:{value:0},hp:{value:10}}
    });
    return d.hp;
  };
  assert.equal(run('용맹공격기술',3,4),9,'bravery triggers when defender level is same or higher');
  assert.equal(run('용맹공격기술',3,2),10,'bravery does not trigger against a lower-level defender');
  assert.equal(run('공포공격기술',3,2),9,'fear triggers when defender level is same or lower');
  assert.equal(run('공포공격기술',3,4),10,'fear does not trigger against a higher-level defender');
});

test('DB29 Manual Vampiric Attack uses actual HP damage, rounds half up, and respects HP markers',()=>{
  // Representative exact Manual Skill1 match from DB29 Actions #571:
  // 다크카운티스 / 10010624542 / Skill1=흡혈공격.
  const run=({attackerHp=2,attackerMaxHp=5,defenderDP=2,attackerHpMarker='',attackAP=3 }={})=>{
    const attacker=unit('10010624542',{
      instanceId:'vampiric-attacker',
      name:'다크카운티스',
      skill:'흡혈공격',
      ap:attackAP,hp:attackerHp,maxHp:attackerMaxHp,
      specialSkillRuleId:'vampiric_attack',
      specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual',
      statMarkers:attackerHpMarker?{hp:attackerHpMarker}:{}
    });
    const defender=unit('defender',{
      instanceId:'vampiric-defender',
      dp:defenderDP,hp:10,maxHp:10
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:attackAP},dp:{value:0},hp:{value:attackerMaxHp}},
      defender:{ap:{value:1},dp:{value:defenderDP},hp:{value:10}}
    });
    return {attacker,defender,result};
  };

  let x=run({attackerHp:2,defenderDP:2,attackAP:3});
  assert.equal(x.result.damage,1,'only one HP actually passes the defender DP');
  assert.equal(x.attacker.hp,3,'ceil(1/2) heals one HP');

  x=run({attackerHp:2,defenderDP:1,attackAP:3});
  assert.equal(x.result.damage,2);
  assert.equal(x.attacker.hp,3,'ceil(2/2) heals one HP');

  x=run({attackerHp:2,defenderDP:0,attackAP:5});
  assert.equal(x.result.damage,5);
  assert.equal(x.attacker.hp,5,'Manual example: HP-5 yields HP+3 (round half up)');

  x=run({attackerHp:2,defenderDP:3,attackAP:3});
  assert.equal(x.result.damage,0,'DP blocks all HP damage');
  assert.equal(x.attacker.hp,2,'blocked damage must not trigger vampiric healing');

  x=run({attackerHp:2,defenderDP:0,attackAP:3,attackerHpMarker:'▼'});
  assert.equal(x.result.damage,3);
  assert.equal(x.attacker.hp,2,'HP-increase marker prevents vampiric healing');
  assert.equal(x.attacker.tempHP||0,0);

  // Manual cardability.htm §6-(b): △ permits increases; ▽ forbids increases.
  x=run({attackerHp:2,defenderDP:0,attackAP:3,attackerHpMarker:'△'});
  assert.equal(x.result.damage,3);
  assert.equal(x.attacker.hp,4,'HP △ permits the Manual half-up vampiric heal of 2');

  x=run({attackerHp:2,defenderDP:0,attackAP:3,attackerHpMarker:'▽'});
  assert.equal(x.result.damage,3);
  assert.equal(x.attacker.hp,2,'HP ▽ prohibits the positive vampiric healing delta');
  assert.equal(x.attacker.tempHP||0,0);

  x=run({attackerHp:2,defenderDP:0,attackAP:3,attackerHpMarker:'*'});
  assert.equal(x.result.damage,3);
  assert.equal(x.attacker.hp,2,'HP * blocks all stat changes including vampiric healing');
  assert.equal(x.attacker.tempHP||0,0);
});

test('DB29 Manual Regeneration restores one HP on attack even when defender DP blocks all damage',()=>{
  // Representative exact Manual Skill1 match from DB29:
  // 울프라이더 / 10010624560 / Skill1=재생능력.
  const run=({attackerHp=2,attackerMaxHp=5,defenderDP=5,attackerHpMarker=''}={})=>{
    const attacker=unit('10010624560',{
      instanceId:'regeneration-attacker',
      name:'울프라이더',
      skill:'재생능력',
      ap:1,hp:attackerHp,maxHp:attackerMaxHp,
      specialSkillRuleId:'regeneration',
      specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual',
      statMarkers:attackerHpMarker?{hp:attackerHpMarker}:{}
    });
    const defender=unit('regeneration-defender',{
      instanceId:'regeneration-defender',
      dp:defenderDP,hp:10,maxHp:10
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:1},dp:{value:0},hp:{value:attackerMaxHp}},
      defender:{ap:{value:1},dp:{value:defenderDP},hp:{value:10}}
    });
    return {attacker,defender,result};
  };

  let x=run({attackerHp:2,defenderDP:5});
  assert.equal(x.result.damage,0,'defender DP blocks all HP damage');
  assert.equal(x.attacker.hp,3,'Manual Regeneration restores one HP when the unit attacks');

  x=run({attackerHp:2,defenderDP:0});
  assert.equal(x.result.damage,1);
  assert.equal(x.attacker.hp,3,'the regeneration amount remains one HP when damage is dealt');

  x=run({attackerHp:2,defenderDP:5,attackerHpMarker:'▼'});
  assert.equal(x.result.damage,0);
  assert.equal(x.attacker.hp,2,'HP-increase prohibition marker prevents regeneration');
  assert.equal(x.attacker.tempHP||0,0);
});

test('DB29 Manual source-backed Skill1 cards preserve petrify, aging and charge attack rules',()=>{
  const run=({id,name,skill,ruleId,attackerAP=1,attackerDP=0,defenderAP=4,defenderDP=2,defenderStatMarkers={}}={})=>{
    const attacker=unit(id,{
      instanceId:'manual-source-attacker',
      name,skill,ap:attackerAP,dp:attackerDP,hp:5,maxHp:5,
      specialSkillRuleId:ruleId,
      specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual'
    });
    const defender=unit('manual-source-defender',{
      instanceId:'manual-source-defender',
      ap:defenderAP,dp:defenderDP,hp:10,maxHp:10,statMarkers:defenderStatMarkers
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:attackerAP},dp:{value:attackerDP},hp:{value:5}},
      defender:{ap:{value:defenderAP},dp:{value:defenderDP},hp:{value:10}}
    });
    return {attacker,defender,result};
  };

  // DB29 exact Manual Skill1 source matches: 파프니르 / 10010624589 / 석화공격.
  let x=run({id:'10010624589',name:'파프니르',skill:'석화공격',ruleId:'petrify_attack'});
  assert.equal(FM.totalPower(x.defender,'ap'),0);
  assert.equal(FM.totalPower(x.defender,'dp'),3);
  assert.equal(x.defender.hp,10);

  // Manual cardability.htm: ▲ prevents decrease, ▼ prevents increase.
  x=run({id:'10010624589',name:'파프니르',skill:'석화공격',ruleId:'petrify_attack',
    defenderStatMarkers:{ap:'▲'}});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'AP increase-only marker protects the printed AP from =0');
  assert.equal(FM.totalPower(x.defender,'dp'),3,'independent DP +1 still applies');

  x=run({id:'10010624589',name:'파프니르',skill:'석화공격',ruleId:'petrify_attack',
    defenderStatMarkers:{dp:'▼'}});
  assert.equal(FM.totalPower(x.defender,'ap'),0,'AP =0 still applies independently');
  assert.equal(FM.totalPower(x.defender,'dp'),2,'DP decrease-only marker blocks the +1 increase');

  // DB29 exact Manual Skill1 source matches: 타락자 / 13020626691 / 노화공격.
  x=run({id:'13020626691',name:'타락자',skill:'노화공격',ruleId:'aging_attack',defenderDP:0});
  assert.equal(FM.totalPower(x.defender,'ap'),2);
  assert.equal(x.defender.hp,9);

  // Manual specialability.htm §8: the effect follows an attack, not HP damage.
  x=run({id:'13020626691',name:'타락자',skill:'노화공격',ruleId:'aging_attack',
    attackerAP:1,defenderAP:4,defenderDP:2});
  assert.equal(x.result.damage,0,'defender DP can block all HP damage');
  assert.equal(x.defender.hp,10);
  assert.equal(FM.totalPower(x.defender,'ap'),2,'the AP -2 aging effect still follows the attack');

  x=run({id:'13020626691',name:'타락자',skill:'노화공격',ruleId:'aging_attack',
    attackerAP:0,defenderAP:4,defenderDP:0});
  assert.equal(x.result.damage,0,'zero AP does not constitute an attack for this rule');
  assert.equal(FM.totalPower(x.defender,'ap'),4,'zero AP leaves target AP unchanged');

  x=run({id:'13020626691',name:'타락자',skill:'노화공격',ruleId:'aging_attack',
    attackerAP:1,defenderAP:4,defenderDP:0,defenderStatMarkers:{ap:'△'}});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'AP △ prevents the AP -2 decrease');

  x=run({id:'13020626691',name:'타락자',skill:'노화공격',ruleId:'aging_attack',
    attackerAP:1,defenderAP:4,defenderDP:0,defenderStatMarkers:{ap:'▽'}});
  assert.equal(FM.totalPower(x.defender,'ap'),2,'AP ▽ permits the AP -2 decrease');

  x=run({id:'13020626691',name:'타락자',skill:'노화공격',ruleId:'aging_attack',
    attackerAP:1,defenderAP:1,defenderDP:0});
  assert.equal(x.defender.hp,9,'the attack resolves before aging modifies AP');
  assert.equal(FM.totalPower(x.defender,'ap'),-1,'AP 1 receives the full Manual AP -2 without a zero clamp');

  // DB29 exact Manual Skill1 source matches: 패스파인더 / 10010624588 / 돌진공격.
  x=run({id:'10010624588',name:'패스파인더',skill:'돌진공격',ruleId:'charge_attack',
    attackerAP:2,attackerDP:3,defenderDP:1});
  assert.equal(x.result.damage,4,'charge uses AP plus DP before the defender DP is applied');
  assert.equal(x.defender.hp,6);

  // Manual specialability.htm §9: "AP가 0이거나 *0인 경우라도 DP 수치만큼 공격".
  x=run({id:'10010624588',name:'패스파인더',skill:'돌진공격',ruleId:'charge_attack',
    attackerAP:0,attackerDP:3,defenderDP:2});
  assert.equal(x.result.damage,1,'zero AP still attacks with own DP minus defender DP');
  assert.equal(x.defender.hp,9);

  x=run({id:'10010624588',name:'패스파인더',skill:'돌진공격',ruleId:'charge_attack',
    attackerAP:0,attackerDP:1,defenderDP:3});
  assert.equal(x.result.damage,0,'defender DP can fully absorb a charge attack powered only by own DP');
  assert.equal(x.defender.hp,10);
});

test('DB29 Manual bravery and fear attacks apply level-gated bonus damage at zero AP',()=>{
  const run=({id,name,skill,ruleId,attackerLevel,defenderLevel}={})=>{
    const attacker=unit(id,{
      instanceId:'level-skill-attacker',name,skill,level:attackerLevel,
      ap:0,dp:0,hp:5,maxHp:5,
      specialSkillRuleId:ruleId,specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual'
    });
    const defender=unit('level-skill-defender',{
      instanceId:'level-skill-defender',level:defenderLevel,ap:1,dp:0,hp:10,maxHp:10
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:0},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:1},dp:{value:0},hp:{value:10}}
    });
    return {attacker,defender,result};
  };

  // DB29 exact Manual Skill1: 타투파이터 / 10010624545 / 용맹공격.
  let x=run({id:'10010624545',name:'타투파이터',skill:'용맹공격',ruleId:'bravery_attack',
    attackerLevel:4,defenderLevel:4});
  assert.equal(x.result.damage,1,'bravery adds one damage when target level is equal, even at AP 0');
  assert.equal(x.defender.hp,9);

  x=run({id:'10010624545',name:'타투파이터',skill:'용맹공격',ruleId:'bravery_attack',
    attackerLevel:4,defenderLevel:3});
  assert.equal(x.result.damage,0,'bravery has no bonus against a lower-level target');

  // DB29 exact Manual Skill1: 다크프리스트 / 10050424835 / 공포공격.
  x=run({id:'10050424835',name:'다크프리스트',skill:'공포공격',ruleId:'fear_attack',
    attackerLevel:4,defenderLevel:3});
  assert.equal(x.result.damage,1,'fear adds one damage against an equal- or lower-level target at AP 0');
  assert.equal(x.defender.hp,9);

  x=run({id:'10050424835',name:'다크프리스트',skill:'공포공격',ruleId:'fear_attack',
    attackerLevel:4,defenderLevel:5});
  assert.equal(x.result.damage,0,'fear has no bonus against a higher-level target');
});

test('DB29 Manual shield-break and curse attacks apply their source-defined stat changes',()=>{
  const run=({id,name,skill,ruleId,attackerAP=1,defenderAP=4,defenderDP=3,defenderStatMarkers={}}={})=>{
    const attacker=unit(id,{
      instanceId:'debuff-skill-attacker',name,skill,ap:attackerAP,dp:0,hp:5,maxHp:5,
      specialSkillRuleId:ruleId,specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual'
    });
    const defender=unit('debuff-skill-defender',{
      instanceId:'debuff-skill-defender',ap:defenderAP,dp:defenderDP,hp:10,maxHp:10,
      statMarkers:defenderStatMarkers
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:attackerAP},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:defenderAP},dp:{value:defenderDP},hp:{value:10}}
    });
    return {attacker,defender,result};
  };

  // DB29 exact Manual Skill1: 해적전투원 / 10010624551 / 방패파괴.
  let x=run({id:'10010624551',name:'해적전투원',skill:'방패파괴',ruleId:'shield_break',
    defenderDP:3});
  assert.equal(x.result.damage,0,'initial DP prevents the one-point attack');
  assert.equal(FM.totalPower(x.defender,'dp'),0,'shield break sets non-negative DP to zero after attack');

  x=run({id:'10010624551',name:'해적전투원',skill:'방패파괴',ruleId:'shield_break',
    defenderDP:-2});
  assert.equal(FM.totalPower(x.defender,'dp'),-2,'shield break does not affect negative DP');

  x=run({id:'10010624551',name:'해적전투원',skill:'방패파괴',ruleId:'shield_break',
    defenderDP:0});
  assert.equal(x.result.damage,1,'an already-zero DP does not block the ordinary attack');
  assert.equal(FM.totalPower(x.defender,'dp'),0);
  assert.equal(x.defender.hp,9);

  // The mapped Skill1 requires an actual attack; zero rolled AP does not trigger it.
  x=run({id:'10010624551',name:'해적전투원',skill:'방패파괴',ruleId:'shield_break',
    attackerAP:0,defenderDP:3});
  assert.equal(x.result.damage,0);
  assert.equal(FM.totalPower(x.defender,'dp'),3,'zero AP leaves positive DP unchanged');
  assert.equal(x.defender.hp,10);

  // Manual common stat markers: △ blocks decreases, while ▽ only blocks increases.
  x=run({id:'10010624551',name:'해적전투원',skill:'방패파괴',ruleId:'shield_break',
    defenderDP:3,defenderStatMarkers:{dp:'△'}});
  assert.equal(x.result.damage,0);
  assert.equal(FM.totalPower(x.defender,'dp'),3,'△ protects the positive DP from being set to zero');
  assert.equal(x.defender.hp,10,'a protected DP is not broken and does not spill into HP');

  x=run({id:'10010624551',name:'해적전투원',skill:'방패파괴',ruleId:'shield_break',
    defenderDP:3,defenderStatMarkers:{dp:'▽'}});
  assert.equal(x.result.damage,0);
  assert.equal(FM.totalPower(x.defender,'dp'),0,'▽ does not block a decrease to zero');
  assert.equal(x.defender.hp,10,'shield break is a post-attack DP effect, not extra HP overflow');

  // DB29 exact Manual Skill1: 다크조커 / 10030324708 / 저주공격.
  x=run({id:'10030324708',name:'다크조커',skill:'저주공격',ruleId:'curse_attack',
    defenderAP:4,defenderDP:3});
  assert.equal(FM.totalPower(x.defender,'ap'),2);
  assert.equal(FM.totalPower(x.defender,'dp'),1);

  // Manual cardability marker rule: △ blocks decreases and ▽ permits them.
  x=run({id:'10030324708',name:'다크조커',skill:'저주공격',ruleId:'curse_attack',
    defenderAP:4,defenderDP:3,defenderStatMarkers:{ap:'△',dp:'▽'}});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'△ protects AP from the curse decrease');
  assert.equal(FM.totalPower(x.defender,'dp'),1,'▽ permits the DP -2 curse');

  x=run({id:'10030324708',name:'다크조커',skill:'저주공격',ruleId:'curse_attack',
    defenderAP:4,defenderDP:3,defenderStatMarkers:{ap:'▽',dp:'△'}});
  assert.equal(FM.totalPower(x.defender,'ap'),2,'▽ permits the AP -2 curse');
  assert.equal(FM.totalPower(x.defender,'dp'),3,'△ protects DP from the curse decrease');

  x=run({id:'10030324708',name:'다크조커',skill:'저주공격',ruleId:'curse_attack',
    attackerAP:0,defenderAP:4,defenderDP:3});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'zero AP does not trigger the curse effect');
  assert.equal(FM.totalPower(x.defender,'dp'),3,'zero AP leaves target DP unchanged');
});

test('DB29 Manual piercing and weakening attacks follow their exact AP and DP effects',()=>{
  const run=({id,name,skill,ruleId,attackerAP,defenderDP,defenderAP=4,defenderStatMarkers={}}={})=>{
    const attacker=unit(id,{
      instanceId:'manual-pierce-attacker',name,skill,ap:attackerAP,dp:0,hp:5,maxHp:5,
      specialSkillRuleId:ruleId,specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual'
    });
    const defender=unit('manual-pierce-defender',{
      instanceId:'manual-pierce-defender',ap:defenderAP,dp:defenderDP,hp:10,maxHp:10,statMarkers:defenderStatMarkers
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:attackerAP},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:defenderAP},dp:{value:defenderDP},hp:{value:10}}
    });
    return {attacker,defender,result};
  };

  // DB29 exact Manual Skill1: 블랙유니콘 / 10091525214 / 관통공격.
  let x=run({id:'10091525214',name:'블랙유니콘',skill:'관통공격',ruleId:'piercing_attack',
    attackerAP:4,defenderDP:2});
  assert.equal(x.result.damage,2,'AP 4 destroys DP 2 and carries the remaining 2 damage to HP');
  assert.equal(FM.totalPower(x.defender,'dp'),0);
  assert.equal(x.defender.hp,8);

  // Manual §4: piercing destroys DP only up to the attacker's AP.
  x=run({id:'10091525214',name:'블랙유니콘',skill:'관통공격',ruleId:'piercing_attack',
    attackerAP:2,defenderDP:4});
  assert.equal(x.result.damage,0,'AP 2 cannot destroy more than two of the defender DP 4');
  assert.equal(FM.totalPower(x.defender,'dp'),2,'the DP not destroyed by AP remains on the defender');
  assert.equal(x.defender.hp,10);

  x=run({id:'10091525214',name:'블랙유니콘',skill:'관통공격',ruleId:'piercing_attack',
    attackerAP:3,defenderDP:0});
  assert.equal(x.result.damage,3,'when defender DP is already zero, all AP remains as HP damage');
  assert.equal(FM.totalPower(x.defender,'dp'),0);
  assert.equal(x.defender.hp,7);

  x=run({id:'10091525214',name:'블랙유니콘',skill:'관통공격',ruleId:'piercing_attack',
    attackerAP:3,defenderDP:3});
  assert.equal(x.result.damage,0,'AP exactly equal to positive DP destroys the DP with no HP overflow');
  assert.equal(FM.totalPower(x.defender,'dp'),0);
  assert.equal(x.defender.hp,10);

  // Manual §4 does not define bonus damage from a pre-existing negative DP.
  // Keep the conservative rule explicit: treat the already-below-zero DP as
  // exhausted, but never add the magnitude of negative DP to HP damage.
  x=run({id:'10091525214',name:'블랙유니콘',skill:'관통공격',ruleId:'piercing_attack',
    attackerAP:4,defenderDP:-2});
  assert.equal(x.result.damage,4,'negative DP does not create damage beyond the printed AP');
  assert.equal(FM.totalPower(x.defender,'dp'),-2,'piercing does not rewrite an already-negative DP value');
  assert.equal(x.defender.hp,6,'the attack deals its four AP, not six damage from AP minus negative DP');

  // Manual specialability.htm §4 + stat marker rule: △ prevents DP decrease.
  x=run({id:'10091525214',name:'블랙유니콘',skill:'관통공격',ruleId:'piercing_attack',
    attackerAP:4,defenderDP:2,defenderStatMarkers:{dp:'△'}});
  assert.equal(x.result.damage,0,'protected positive DP does not break, so there is no overflow to HP');
  assert.equal(FM.totalPower(x.defender,'dp'),2,'△ prevents the DP decrease');
  assert.equal(x.defender.hp,10,'AP cannot spill into HP until DP is actually reduced to zero');

  x=run({id:'10091525214',name:'블랙유니콘',skill:'관통공격',ruleId:'piercing_attack',
    attackerAP:4,defenderDP:2,defenderStatMarkers:{dp:'▽'}});
  assert.equal(x.result.damage,2,'▽ only blocks increases, so a legal DP decrease still breaks DP and overflows');
  assert.equal(FM.totalPower(x.defender,'dp'),0);
  assert.equal(x.defender.hp,8);
  x=run({id:'10091525190',name:'이블크로우',skill:'약화공격',ruleId:'weaken_attack',
    attackerAP:1,defenderDP:3});
  assert.equal(x.result.damage,0,'the defender DP blocks the initial attack');
  assert.equal(FM.totalPower(x.defender,'ap'),3,'weakening applies AP -1 after an attack even when HP damage is zero');
  assert.equal(FM.totalPower(x.defender,'dp'),2,'weakening applies DP -1 after an attack even when HP damage is zero');

  x=run({id:'10091525190',name:'이블크로우',skill:'약화공격',ruleId:'weaken_attack',
    attackerAP:3,defenderDP:1});
  assert.equal(x.result.damage,2,'the source-backed weakening effect also applies after positive HP damage');
  assert.equal(x.defender.hp,8);
  assert.equal(FM.totalPower(x.defender,'ap'),3);
  assert.equal(FM.totalPower(x.defender,'dp'),0);
});

test('DB29 Manual charm attack disables AP only when DP prevents all HP damage',()=>{
  const run=({defenderDP}={})=>{
    const attacker=unit('10020324637',{
      instanceId:'manual-charm-attacker',name:'데몬',skill:'매료공격',ap:1,dp:0,hp:5,maxHp:5,
      specialSkillRuleId:'charm_attack',specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual'
    });
    const defender=unit('manual-charm-defender',{
      instanceId:'manual-charm-defender',ap:4,dp:defenderDP,hp:10,maxHp:10
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:4},dp:{value:defenderDP},hp:{value:10}}
    });
    return {defender,result};
  };
  let x=run({defenderDP:2});
  assert.equal(x.result.damage,0);
  assert.equal(FM.totalPower(x.defender,'ap'),0,'blocked attack sets target AP to zero');
  x=run({defenderDP:0});
  assert.equal(x.result.damage,1);
  assert.equal(FM.totalPower(x.defender,'ap'),4,'successful HP damage does not trigger charm AP suppression');
});

test('DB29 Manual defense-convert applies the negative DP marker only when target DP is positive',()=>{
  const run=(defenderDP)=>{
    const attacker=unit('10010624563',{
      instanceId:'manual-defense-convert-attacker',name:'리듬포이',skill:'방어전환공격',
      ap:1,dp:0,hp:5,maxHp:5,specialSkillRuleId:'defense_convert',
      specialSkillMappingStatus:'manual_verified',specialSkillRuleAuthority:'manual'
    });
    const defender=unit('manual-defense-convert-defender',{
      instanceId:'manual-defense-convert-defender',ap:3,dp:defenderDP,hp:10,maxHp:10
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:3},dp:{value:defenderDP},hp:{value:10}}
    });
    return {defender,result};
  };

  // Manual.zip / specialability.htm / 27. 방어전환기술:
  // "공격당한 상대는 DP에 - 가 붙게 됩니다."
  let x=run(4);
  assert.equal(x.result.damage,0,'positive DP blocks the one-point attack before the sign conversion');
  assert.equal(FM.totalPower(x.defender,'dp'),-4,'positive DP receives the negative sign');

  x=run(0);
  assert.equal(x.result.damage,1,'zero DP does not block the one-point attack');
  assert.equal(FM.totalPower(x.defender,'dp'),0,'negative sign applied to zero remains zero');

  x=run(-2);
  assert.equal(x.result.damage,3,'already-negative DP increases the incoming damage by two');
  assert.equal(FM.totalPower(x.defender,'dp'),-2,'already-negative DP stays negative');
});

test('DB29 Manual beast tamer, spell suppression and weapon suppression require the exact target ability and honor AP markers',()=>{
  const run=({id,name,skill,ruleId,targetAbility,targetTags,attackerAP=1,ap=4,defenderStatMarkers={}}={})=>{
    const attacker=unit(id,{
      instanceId:'ability-gate-attacker',name,skill,ap:attackerAP,dp:0,hp:5,maxHp:5,
      specialSkillRuleId:ruleId,specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual'
    });
    const defender=unit('ability-gate-defender',{
      instanceId:'ability-gate-defender',ap,dp:0,hp:10,maxHp:10,
      unitAbility:targetAbility,unitAbilityTags:targetTags,
      statMarkers:defenderStatMarkers
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:attackerAP},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:ap},dp:{value:0},hp:{value:10}}
    });
    return {attacker,defender,result};
  };

  // DB29 exact Manual Skill1: 네추럴마스터 / 11011925567 / 야수조련.
  let x=run({id:'11011925567',name:'네추럴마스터',skill:'야수조련',ruleId:'beast_tamer',
    targetAbility:'야수능력',targetTags:['야수']});
  assert.equal(FM.totalPower(x.defender,'ap'),0,'beast ability is suppressed');
  x=run({id:'11011925567',name:'네추럴마스터',skill:'야수조련',ruleId:'beast_tamer',
    targetAbility:'장비능력',targetTags:['장비']});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'non-beast target is unaffected');

  x=run({id:'11011925567',name:'네추럴마스터',skill:'야수조련',ruleId:'beast_tamer',
    targetAbility:'야수능력',targetTags:['야수'],attackerAP:0});
  assert.equal(x.result.damage,0);
  assert.equal(FM.totalPower(x.defender,'ap'),4,'zero AP does not trigger Beast Tamer');

  x=run({id:'11011925567',name:'네추럴마스터',skill:'야수조련',ruleId:'beast_tamer',
    targetAbility:'야수능력',targetTags:['야수'],defenderStatMarkers:{ap:'△'}});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'AP △ blocks Beast Tamer');

  x=run({id:'11011925567',name:'네추럴마스터',skill:'야수조련',ruleId:'beast_tamer',
    targetAbility:'야수능력',targetTags:['야수'],defenderStatMarkers:{ap:'▽'}});
  assert.equal(FM.totalPower(x.defender,'ap'),0,'AP ▽ permits Beast Tamer');

  // DB29 exact Manual Skill1: 혼드비스트 / 10010624550 / 주문봉쇄.
  x=run({id:'10010624550',name:'혼드비스트',skill:'주문봉쇄',ruleId:'spell_suppression',
    targetAbility:'마법능력',targetTags:['마법']});
  assert.equal(FM.totalPower(x.defender,'ap'),0,'magic ability is suppressed');
  x=run({id:'10010624550',name:'혼드비스트',skill:'주문봉쇄',ruleId:'spell_suppression',
    targetAbility:'야수능력',targetTags:['야수']});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'non-magic target is unaffected');

  x=run({id:'10010624550',name:'혼드비스트',skill:'주문봉쇄',ruleId:'spell_suppression',
    targetAbility:'마법능력',targetTags:['마법'],attackerAP:0});
  assert.equal(x.result.damage,0);
  assert.equal(FM.totalPower(x.defender,'ap'),4,'zero AP does not trigger Spell Suppression');

  x=run({id:'10010624550',name:'혼드비스트',skill:'주문봉쇄',ruleId:'spell_suppression',
    targetAbility:'마법능력',targetTags:['마법'],defenderStatMarkers:{ap:'△'}});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'AP △ blocks Spell Suppression');

  x=run({id:'10010624550',name:'혼드비스트',skill:'주문봉쇄',ruleId:'spell_suppression',
    targetAbility:'마법능력',targetTags:['마법'],defenderStatMarkers:{ap:'▽'}});
  assert.equal(FM.totalPower(x.defender,'ap'),0,'AP ▽ permits Spell Suppression');

  // DB29 exact Manual Skill1: 데크라프 / 10010624543 / 무기봉쇄.
  x=run({id:'10010624543',name:'데크라프',skill:'무기봉쇄',ruleId:'weapon_suppression',
    targetAbility:'장비능력',targetTags:['장비']});
  assert.equal(FM.totalPower(x.defender,'ap'),0,'equipment ability is suppressed');
  x=run({id:'10010624543',name:'데크라프',skill:'무기봉쇄',ruleId:'weapon_suppression',
    targetAbility:'마법능력',targetTags:['마법']});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'non-equipment target is unaffected');

  x=run({id:'10010624543',name:'데크라프',skill:'무기봉쇄',ruleId:'weapon_suppression',
    targetAbility:'장비능력',targetTags:['장비'],attackerAP:0});
  assert.equal(x.result.damage,0);
  assert.equal(FM.totalPower(x.defender,'ap'),4,'zero AP does not trigger Weapon Suppression');

  x=run({id:'10010624543',name:'데크라프',skill:'무기봉쇄',ruleId:'weapon_suppression',
    targetAbility:'장비능력',targetTags:['장비'],defenderStatMarkers:{ap:'△'}});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'AP △ blocks Weapon Suppression');

  x=run({id:'10010624543',name:'데크라프',skill:'무기봉쇄',ruleId:'weapon_suppression',
    targetAbility:'장비능력',targetTags:['장비'],defenderStatMarkers:{ap:'▽'}});
  assert.equal(FM.totalPower(x.defender,'ap'),0,'AP ▽ permits Weapon Suppression');
});

test('DB29 source card Eunryong Sword uses the Manual ordinary-attack baseline',()=>{
  // Exact DB29 source row: 은룡의검 / 10020341112 / Skill1 일반공격.
  // Manual specialability.htm §1 defines ordinary AP-vs-DP combat as the baseline.
  const attacker=unit('10020341112',{
    instanceId:'db29-eunryong-sword',
    name:'은룡의검',
    skill:'일반공격',
    ap:3,dp:1,hp:8,maxHp:8,
    specialSkillRuleId:'normal_attack',
    specialSkillMappingStatus:'manual_verified',
    specialSkillRuleAuthority:'manual'
  });
  const defender=unit('normal-attack-target',{
    instanceId:'normal-attack-target',
    ap:1,dp:1,hp:8,maxHp:8
  });
  const p=player('player',{units:[attacker]});
  const ai=player('ai',{units:[defender]});
  const s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:3},dp:{value:1},hp:{value:8}},
    defender:{ap:{value:1},dp:{value:1},hp:{value:8}}
  });
  assert.equal(result.damage,2,'ordinary attack applies AP minus defender DP');
  assert.equal(defender.hp,6);
  assert.equal(defender.dp,1,'ordinary attack does not mutate defender DP');
});

test('DB29 Manual catalogue exposes all 27 rule IDs with their actual source Skill1 labels',()=>{
  const normalize=FM._test.normalizeSpecialSkillForEngine;
  const cases={
    normal_attack:'일반공격',
    defense_bypass:'방어무시',
    fatal_attack:'치명공격',
    piercing_attack:'관통공격',
    weaken_attack:'약화공격',
    petrify_attack:'석화공격',
    vampiric_attack:'흡혈공격',
    aging_attack:'노화공격',
    charge_attack:'돌진공격',
    beast_tamer:'야수조련공격',
    bravery_attack:'용맹공격',
    regeneration:'재생능력',
    frenzy_attack:'광분공격',
    consecutive_attack:'연속공격',
    fear_attack:'공포공격',
    charm_attack:'매료공격',
    ability_seal:'봉쇄공격',
    spell_suppression:'마법봉쇄공격',
    weapon_suppression:'무기뺏기공격',
    copy_attack:'복제공격',
    shield_break:'방패파괴공격',
    curse_attack:'저주공격',
    defensive_use:'방어이용',
    taunt_attack:'조롱',
    confusion_attack:'혼란공격',
    stealth_attack:'은폐공격',
    defense_convert:'방어전환공격'
  };
  assert.equal(Object.keys(FM._test.SPECIAL_SKILL_RULE_KEYWORDS).length,27);
  for(const [ruleId,expected] of Object.entries(cases)){
    const cardUnit={specialSkillRuleId:ruleId,specialSkillMappings:[{
      sourceField:'Skill1',mappingStatus:'manual_verified',ruleAuthority:'manual',ruleId
    }]};
    assert.equal(normalize(cardUnit,''),expected,ruleId);
  }
});

test('community-only DB29 skill candidates remain non-executable even if their source names resemble skills',()=>{
  const candidateMetadata={skill:'강한공포',specialSkillRuleId:null,specialSkillMappings:[{
    sourceField:'Skill1',sourceName:'강한공포',mappingStatus:'community_documented_candidate',
    ruleAuthority:'community',ruleId:'strong_fear'
  }]};
  assert.equal(FM._test.normalizeSpecialSkillForEngine(candidateMetadata,candidateMetadata.skill),'');
  const d=unit('community-defender',{instanceId:'community-d',ap:1,dp:0,hp:10,maxHp:10});
  const a=unit('community-attacker',{instanceId:'community-a',ap:3,dp:0,hp:10,maxHp:10,...candidateMetadata});
  const p=player('player',{units:[a]}),ai=player('ai',{units:[d]}),st=state(p,ai);
  FM._test.resolveUnitAttack(st,p,ai,a,d,{
    attacker:{ap:{value:3},dp:{value:0},hp:{value:10}},
    defender:{ap:{value:1},dp:{value:0},hp:{value:10}}
  });
  assert.equal(d.hp,7,'only ordinary AP damage is applied; community bonus is not run');
});

test('actual Skill1 aliases for source enum names execute the mapped Manual baseline rules',()=>{
  const runMapped=(ruleId,skill,attackerOptions,defenderOptions,rolls)=>{
    const a=unit('mapped-a',{instanceId:'mapped-a',skill,...attackerOptions,
      specialSkillRuleId:ruleId,specialSkillMappings:[{
        sourceField:'Skill1',mappingStatus:'manual_verified',ruleAuthority:'manual',ruleId
      }]});
    const d=unit('mapped-d',{instanceId:'mapped-d',...defenderOptions});
    const p=player('player',{units:[a]}),ai=player('ai',{units:[d]}),st=state(p,ai);
    const result=FM._test.resolveUnitAttack(st,p,ai,a,d,rolls||{
      attacker:{ap:{value:a.ap},dp:{value:a.dp},hp:{value:a.maxHp}},
      defender:{ap:{value:d.ap},dp:{value:d.dp},hp:{value:d.maxHp}}
    });
    return {a,d,result};
  };
  let x=runMapped('defense_bypass','방어무시',{ap:2},{dp:5,hp:10});
  assert.equal(x.d.hp,8);
  x=runMapped('ability_seal','기술봉쇄',{ap:1},{ap:3,dp:0,hp:10,skill:'방어무시'});
  assert.equal(x.d.skill,'일반공격기술');
  x=runMapped('spell_suppression','주문봉쇄',{ap:1},{ap:3,dp:0,hp:10,unitAbility:'마법능력',unitAbilityTags:['마법']});
  assert.equal(FM.totalPower(x.d,'ap'),0);
  x=runMapped('weapon_suppression','무기봉쇄',{ap:1},{ap:3,dp:0,hp:10,unitAbility:'장비능력',unitAbilityTags:['장비']});
  assert.equal(FM.totalPower(x.d,'ap'),0);
  x=runMapped('copy_attack','공격복제',{ap:1},{ap:4,dp:1,hp:10},{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:10}},
    defender:{ap:{value:5},dp:{value:1},hp:{value:10}}
  });
  assert.equal(x.d.hp,6);
  x=runMapped('defense_convert','방어변환',{ap:1},{dp:3,hp:10});
  assert.equal(FM.totalPower(x.d,'dp'),-3);
});

test('DB29 Manual Consecutive Attack applies AP-minus-one doubling with DP and boundary clamps',()=>{
  // Exact DB29 Skill1 label match: 트윈스컬소드 / 10050441142 / 연속공격.
  // The mechanic is defined by Manual.zip: reduce AP by one, then double
  // the remaining attack value before subtracting the defender's DP.
  const run=(attackAP,defenderDP,targetHP=10)=>{
    const attacker=unit('10050441142',{
      instanceId:'consecutive-attacker-'+attackAP+'-'+defenderDP,
      name:'트윈스컬소드',
      skill:'연속공격기술',
      ap:attackAP,
      specialSkillRuleId:'consecutive_attack',
      specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual'
    });
    const defender=unit('consecutive-defender',{
      instanceId:'consecutive-defender-'+attackAP+'-'+defenderDP,
      dp:defenderDP,hp:targetHP,maxHp:targetHP
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:attackAP},dp:{value:0},hp:{value:10}},
      defender:{ap:{value:1},dp:{value:defenderDP},hp:{value:targetHP}}
    });
    return {attacker,defender,result};
  };

  let x=run(3,1);
  assert.equal(x.result.damage,3,'(3 AP - 1) * 2 - 1 DP = 3 HP damage');
  assert.equal(x.defender.hp,7);

  x=run(1,0);
  assert.equal(x.result.damage,0,'AP 1 becomes zero before doubling');
  assert.equal(x.defender.hp,10,'the boundary case must not create damage');

  x=run(3,-2);
  assert.equal(x.result.damage,6,'negative DP retains its signed contribution');
  assert.equal(x.defender.hp,4);

  x=run(0,0);
  assert.equal(x.result.damage,0,'zero rolled AP cannot produce negative or fabricated damage');
  assert.equal(x.defender.hp,10);
});

test('neutral upkeep is charged only for units with a neutral soul cost and limits deployment after upkeep',()=>{
  const noNeutral=unit('no-neutral',{cost:{forest:1},costKnown:true});
  const withNeutral=unit('with-neutral',{cost:{forest:1,neutral:1},costKnown:true});
  const p=player('player',{lands:[land('land','forest',1,0)],units:[noNeutral,withNeutral]});
  const s=state(p,player('ai'));
  FM._test.beginPhase(s,'player');
  assert.equal(p.neutralUpkeep,1);
  assert.equal(p.soulPool.colored.forest,0);
  assert.equal(p.unitDeployLimit,0);
});


test('missing source cost receives a payable fallback while an empty claimed-known object remains invalid',()=>{
  const missing={...unit('missing-cost'),instanceId:'missing-cost-1',cost:null,costKnown:false,costMapped:false};
  const empty={...unit('empty-cost'),instanceId:'empty-cost-1',cost:{},costKnown:true,costMapped:true};
  const p=player('player',{hand:[missing,empty],soulPool:{colored:{forest:10},neutral:10},unitDeployLimit:10});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','missing-cost-1').ok,true);
  assert.equal(p.soulPool.neutral,9);
  assert.equal(FM.playCard(s,'player','empty-cost-1').ok,false);
});


test('direct attack refuses to infer zero deck damage from an unverified empty summon cost',()=>{
  const p=player('player');
  const ai=player('ai');
  const s=state(p,ai);
  const attacker=unit('unverified-direct',{cost:{},costKnown:true,costMapped:true});
  const before=ai.deck.length;
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,null);
  assert.equal(result.invalidCost,true);
  assert.equal(ai.deck.length,before);
});

test('FM1 opponent-facing special effects require rolled AP of at least one, except explicit self/bonus skills',()=>{
  const run=(skill,aExtra={},dExtra={},rolledAP=0)=>{
    const a=unit('a',{instanceId:'a',skill,...aExtra});
    const d=unit('d',{instanceId:'d',...dExtra});
    const p=player('player',{units:[a]}),ai=player('ai',{units:[d]}),s=state(p,ai);
    const rolls={
      attacker:{ap:{value:rolledAP},dp:{value:a.dp},hp:{value:a.hp}},
      defender:{ap:{value:d.ap},dp:{value:d.dp},hp:{value:d.hp}}
    };
    const result=FM._test.resolveUnitAttack(s,p,ai,a,d,rolls);
    return {a,d,result};
  };

  let x=run('치명공격기술',{ap:0},{dp:0,hp:10},0);
  assert.equal(x.d.hp,10);
  x=run('약화공격기술',{ap:0},{ap:4,dp:2,hp:10},0);
  assert.equal(FM.totalPower(x.d,'ap'),4);
  assert.equal(FM.totalPower(x.d,'dp'),2);
  x=run('복제공격기술',{ap:0},{ap:5,dp:0,hp:10},0);
  assert.equal(x.d.hp,10);
  x=run('방어이용공격기술',{ap:0},{dp:3,hp:10},0);
  assert.equal(x.d.hp,10);
  x=run('봉쇄공격기술',{ap:0},{skill:'흡혈공격기술',dp:0,hp:10},0);
  assert.equal(x.d.skill,'흡혈공격기술');
  x=run('재생능력',{ap:0,hp:2,maxHp:5},{dp:0,hp:10},0);
  assert.equal(x.a.hp,3);
  x=run('은폐공격기술',{ap:0,dp:2},{dp:0,hp:10},0);
  assert.equal(FM.totalPower(x.a,'dp'),3);
  x=run('돌진공격기술',{ap:0,dp:2},{dp:0,hp:10},0);
  assert.equal(x.d.hp,8);
  x=run('광분공격기술',{ap:0,hp:5,maxHp:5},{dp:0,hp:10},0);
  assert.equal(x.a.hp,1);
  assert.equal(x.d.hp,6);
});

test('unit summon with insufficient colored soul leaves hand, field, and soul pool unchanged',()=>{
  const card={...unit('wrong-color-cost'),instanceId:'wrong-color-1',cost:{fire:1}};
  const p=player('player',{hand:[card],soulPool:{colored:{forest:1},neutral:0},
    unitDeployLimit:1,unitDeployedThisPhase:0});
  const s=state(p,player('ai'));
  const before=JSON.stringify(p.soulPool);
  const result=FM.playCard(s,'player','wrong-color-1');
  assert.equal(result.ok,false);
  assert.match(result.reason,/소울이 부족/);
  assert.equal(p.hand.length,1);
  assert.equal(p.hand[0].instanceId,'wrong-color-1');
  assert.equal(p.units.length,0);
  assert.equal(p.unitDeployedThisPhase,0);
  assert.equal(JSON.stringify(p.soulPool),before);
});

test('explicit LP 0 terrain remains free to install at zero current LP',()=>{
  const Schema=require('../app/src/main/assets/game/card-schema.js');
  const card=Schema.normalize({
    id:'explicit-lp-zero',name:'LP0 지형',type:'land',faction:'light',souls:['light'],soulValue:1,
    requiredLP:0,requiredLPKnown:true,landInstallCost:{neutral:0},landInstallCostKnown:true,
    soulProductionStatus:'source-decoded',description:'필요LP : 0'
  });
  assert.equal(card.requiredLP,0);
  assert.equal(card.rules.requiredLPStatus,'source-defined');
  card.instanceId='lp-zero-1';
  const p=player('player',{hand:[card],lp:0,soulPool:{colored:{},neutral:0}});
  const result=FM.playCard(state(p,player('ai')),'player','lp-zero-1');
  assert.equal(result.ok,true);
  assert.equal(p.lp,0);
  assert.equal(p.lands.length,1);
  assert.equal(p.lands[0].id,'explicit-lp-zero');
});

test('candidate source status is preserved while a simple timed spell gets an inferred runtime handler',()=>{
  const card=CardSchema.normalize({id:'simple-spell',name:'간단한 피해 마법',type:'spell',faction:'forest',
    text:'적군 유닛에게 2의 피해',triggerTiming:'공격 턴',
    tabs:{'분류별':[{text:'발동 시점: 공격 턴'}]},cost:{},runtimeCost:{neutral:1},runtimeCostKnown:true,
    runtimeEffectDisposition:'implemented_inferred',effectExecutionStatus:'candidate-only',
    effectVerificationStatus:'pattern_candidate',effectCandidates:[{verificationStatus:'pattern_candidate'}]});
  assert.equal(card.effectExecutionStatus,'candidate-only');
  assert.equal(card.effectVerificationStatus,'pattern_candidate');
  assert.equal(card.runtimeEffectDisposition,'implemented_inferred');
  assert.equal(card.effect.type,'damage');
  assert.equal(card.effect.target,'enemyUnit');
  assert.equal(card.effect.amount,2);
  assert.equal(FM.validateCardForPlay(card).ok,true);
  card.instanceId='simple-spell-1';
  const p=player('player',{hand:[card],soulPool:{colored:{},neutral:1}});
  const enemy=player('ai',{units:[unit('spell-target',{instanceId:'spell-target-1'})]});
  const played=FM.playCard(state(p,enemy),'player','simple-spell-1','spell-target-1');
  assert.equal(played.ok,true);
  assert.equal(p.spells.length,1);
  assert.equal(p.spells[0].selectedTargetId,'spell-target-1');
});

test('complex source effect remains a terminal no-op when the simple parser cannot map it',()=>{
  const card=CardSchema.normalize({id:'complex-spell',name:'복합 마법',type:'spell',faction:'forest',
    text:'각각 무작위 유닛의 레벨에 맞게 효과를 적용한다',triggerTiming:'상대 턴',cost:{},
    runtimeCost:{neutral:1},runtimeCostKnown:true,runtimeEffectDisposition:'fallback_noop',
    effectExecutionStatus:'candidate-only',effectVerificationStatus:'pattern_candidate',
    effectCandidates:[{verificationStatus:'pattern_candidate'}]});
  assert.equal(card.effectExecutionStatus,'candidate-only');
  assert.equal(card.runtimeEffectDisposition,'fallback_noop');
  assert.equal(card.effect,null);
});

test('enchant simple text remains a terminal fallback until event-duration slot handling exists',()=>{
  const base={id:'simple-enchant',name:'간단한 인챈트',type:'enchant',faction:'forest',
    text:'아군 유닛의 AP를 +2만큼 증가',triggerTiming:'자신 턴',cost:{},runtimeCost:{neutral:1},
    runtimeCostKnown:true,runtimeEffectDisposition:'fallback_noop',effectExecutionStatus:'candidate-only',
    effectVerificationStatus:'pattern_candidate',effectCandidates:[{verificationStatus:'pattern_candidate'}],
    tabs:{'분류별':[{label:'슬롯 위치',text:'아군 슬롯 1'}]}};
  const card=CardSchema.normalize(base);
  assert.equal(card.runtimeEffectDisposition,'fallback_noop');
  assert.equal(card.effect,null);
  assert.equal(FM.validateCardForPlay(card).ok,true);
  card.instanceId='simple-enchant-1';
  const p=player('player',{hand:[card],soulPool:{colored:{},neutral:1}});
  const played=FM.playCard(state(p,player('ai')),'player','simple-enchant-1');
  assert.equal(played.ok,true);
  assert.equal(p.hand.length,0);
  assert.equal(p.graveyard.length,1);
  assert.equal(p.soulPool.neutral,0);
});

test('candidate-only enchant resolves as a paid deterministic no-op instead of blocking the card',()=>{
  const card={id:'candidate-enchant',instanceId:'candidate-enchant-1',name:'후보 인챈트',type:'enchant',
    cost:{},costKnown:false,costMapped:false,runtimeCost:{fire:1},runtimeCostKnown:true,
    runtimeEffectDisposition:'fallback_noop',slotIndex:null,slotOwner:null,
    effectExecutionStatus:'candidate-only',effectVerificationStatus:'pattern_candidate',
    effectCandidates:[{verificationStatus:'pattern_candidate'}]};
  const p=player('player',{hand:[card],soulPool:{colored:{fire:1},neutral:0}});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','candidate-enchant-1');
  assert.equal(result.ok,true);
  assert.equal(result.effectDisposition,'fallback_noop');
  assert.equal(p.hand.length,0);
  assert.equal(p.graveyard.length,1);
  assert.equal(p.soulPool.colored.fire,0);
  assert.equal(s.status,'playing');
});

test('pending source-cost status does not block a card with an inferred payable runtime cost',()=>{
  const card=unit('inferred-runtime-cost',{instanceId:'inferred-runtime-cost-1',cost:{},costKnown:false,costMapped:false,
    runtimeCost:{neutral:1},runtimeCostKnown:true,runtimeCostStatus:'implemented_inferred',
    runtimeUpkeepCost:{neutral:0}});
  const p=player('player',{hand:[card],soulPool:{colored:{},neutral:1},unitDeployLimit:1});
  const result=FM.playCard(state(p,player('ai')),'player','inferred-runtime-cost-1');
  assert.equal(result.ok,true);
  assert.equal(p.soulPool.neutral,0);
  assert.equal(p.units.length,1);
});

test('Manual NCS runtime cost pays from the pool and applies unit-only recurring upkeep',()=>{
  const ncs=unit('ncs-runtime',{instanceId:'ncs-runtime-1',runtimeCost:{neutral:1},runtimeCostKnown:true,
    runtimeUpkeepCost:{neutral:1},costKnown:false,costMapped:false});
  const p=player('player',{hand:[ncs],soulPool:{colored:{},neutral:2},unitDeployLimit:1});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','ncs-runtime-1');
  assert.equal(result.ok,true);
  assert.equal(p.soulPool.neutral,1);
  FM._test.beginPhase(s,'player');
  assert.equal(p.neutralUpkeep,1);
  assert.equal(p.soulPool.neutral,0);
  assert.equal(s.status,'playing');
});

test('BONUS one-time runtime payment is excluded from recurring unit upkeep',()=>{
  const bonus=unit('bonus-runtime',{runtimeCost:{neutral:2},runtimeCostKnown:true,
    runtimeUpkeepCost:{neutral:0},costKnown:false,costMapped:false});
  const p=player('player',{units:[bonus],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  FM._test.beginPhase(s,'player');
  assert.equal(p.neutralUpkeep,0);
  assert.equal(s.status,'playing');
});

test('missing legacy upkeep provenance uses finite conservative fallback and never ends the match by Infinity',()=>{
  const unknown=unit('unknown-upkeep',{cost:{},costKnown:false,costMapped:false});
  const p=player('player',{units:[unknown],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  FM._test.beginPhase(s,'player');
  assert.equal(p.neutralUpkeep,1);
  assert.equal(s.status,'playing');
  assert.equal(p.deck.length,13);
});

test('unmapped spell effect is paid, consumed and closed as a deterministic no-op',()=>{
  const card={id:'unknown-spell',instanceId:'unknown-spell-1',name:'미확인 마법',type:'spell',
    costKnown:false,costMapped:false,runtimeCost:{neutral:1},runtimeCostKnown:true,
    runtimeEffectDisposition:'fallback_noop',effect:null};
  const p=player('player',{hand:[card],soulPool:{colored:{},neutral:1}});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','unknown-spell-1');
  assert.equal(result.ok,true);
  assert.equal(result.effectDisposition,'fallback_noop');
  assert.equal(p.hand.length,0);
  assert.equal(p.graveyard.length,1);
  assert.equal(p.soulPool.neutral,0);
  assert.equal(s.status,'playing');
});

test('partial item fallback preserves parsed owner and race restrictions',()=>{
  const item={id:'partial-item',instanceId:'partial-item-1',name:'부분 해석 아이템',type:'item',
    cost:{},runtimeCost:{neutral:0},runtimeCostKnown:true,runtimeItemConditionStatus:'fallback_any_unit',
    itemConditions:{owner:'own',race:'버드',affiliation:null,unsupported:['unparsed-special-clause'],mapped:false}};
  const wrong=unit('wrong-race',{instanceId:'wrong-race-1',race:'휴먼'});
  const correct=unit('right-race',{instanceId:'right-race-1',race:'버드'});
  const p=player('player',{hand:[item],units:[wrong,correct],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','partial-item-1','wrong-race-1').ok,false);
  assert.equal(p.hand.length,1);
  assert.equal(FM.playCard(s,'player','partial-item-1','right-race-1').ok,true);
  assert.equal(correct.equipment.includes('부분 해석 아이템'),true);
});

test('unmapped item condition gets a deterministic any-unit fallback and remains consumable without a target',()=>{
  const card={id:'unknown-item',instanceId:'unknown-item-1',name:'미확인 장비',type:'item',
    costKnown:false,costMapped:false,runtimeCost:{neutral:1},runtimeCostKnown:true,
    runtimeItemConditionStatus:'fallback_any_unit',allowedUnitAbilities:['만능'],
    itemConditions:{mapped:false,unsupported:['race']}};
  const p=player('player',{hand:[card],soulPool:{colored:{},neutral:1}});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','unknown-item-1');
  assert.equal(result.ok,true);
  assert.equal(result.effectDisposition,'fallback_noop');
  assert.equal(p.hand.length,0);
  assert.equal(p.graveyard.length,1);
  assert.equal(p.soulPool.neutral,0);
});

test('compact DB29 community candidate status blocks source-name fallback',()=>{
  const unit={skill:'강한공포',specialSkillRuleId:null,
    specialSkillMappingStatus:'community_documented_candidate',
    specialSkillRuleAuthority:'community'};
  assert.equal(FM._test.normalizeSpecialSkillForEngine(unit,unit.skill),'');
});

test('compact DB29 Manual Skill1 fields activate only the mapped canonical rule ID',()=>{
  const unit={skill:'기술봉쇄',specialSkillRuleId:'ability_seal',
    specialSkillMappingStatus:'manual_verified',specialSkillRuleAuthority:'manual'};
  assert.equal(FM._test.normalizeSpecialSkillForEngine(unit,unit.skill),'봉쇄공격');
  const forged={skill:'강한공포',specialSkillRuleId:'strong_fear',
    specialSkillMappingStatus:'manual_verified',specialSkillRuleAuthority:'community'};
  assert.equal(FM._test.normalizeSpecialSkillForEngine(forged,forged.skill),'');
});


test('a Skill2-only ability never falls through to the Skill1 combat handler',()=>{
  const attacker=unit('skill2-only',{
    skill:'일반공격기술 / 헌신방어',
    specialSkill1:'없음',
    specialSkill2:'헌신방어',
    specialSkillMappingStatus:'no_special_skill',
    specialSkillRuleAuthority:null,
    specialSkillRuleId:null,
    specialSkill2MappingStatus:'unmapped',
    specialSkill2RuleId:null
  });
  assert.equal(FM._test.normalizeSpecialSkillForEngine(attacker,attacker.specialSkill2),'');
});

test('a unit with an unmapped Skill2 remains playable and completes its summon action',()=>{
  const card=unit('db29-unmapped-skill2',{
    instanceId:'db29-unmapped-skill2',
    name:'Skill2 검토 대기 유닛',
    skill:'일반공격기술 / 헌신방어',
    specialSkill1:'없음',
    specialSkill2:'헌신방어',
    specialSkillMappingStatus:'no_special_skill',
    specialSkillRuleAuthority:null,
    specialSkillRuleId:null,
    specialSkill2MappingStatus:'unmapped',
    specialSkill2RuleId:null,
    cost:{forest:1},
    costKnown:true,
    costMapped:true
  });
  const p=player('player',{
    hand:[card],
    soulPool:{colored:{forest:1},neutral:0},
    unitDeployLimit:1
  });
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','db29-unmapped-skill2');
  assert.equal(result.ok,true,'unmapped Skill2 provenance must not disable the whole card');
  assert.equal(p.hand.length,0,'the card leaves the hand');
  assert.equal(p.units.length,1,'the unit is deployed normally');
  assert.equal(p.unitDeployedThisPhase,1);
  assert.equal(p.playedAnyCardThisPhase,true,'the preparation-phase action reaches its terminal state');
  assert.equal(FM._test.normalizeSpecialSkill2ForEngine(p.units[0],p.units[0].specialSkill2),'',
    'unverified Skill2 remains non-executable without blocking the unit summon');
});

function sourceSkill2(id,name,extra={}){
  const ruleIds={
    '기선제압':'skill2_tactical_initiative',
    '헌신방어':'skill2_devoted_defense',
    '격노':'skill2_frenzy_defense',
    '홀리오오라':'skill2_holy_aura',
    '얼라이디펜스':'skill2_alliance_defense',
    '레이셜디펜스':'skill2_racial_defense',
    '강한헌신방어':'skill2_strong_devoted_defense',
    '프레셔':'skill2_pressure_defense'
  };
  return unit(id,{
    specialSkill2:name,
    specialSkill2MappingStatus:'source_card_verified',
    specialSkill2RuleId:ruleIds[name],
    specialSkill2RuleAuthority:'card_source',
    specialSkill2ExecutionStatus:'source-card-rule-implemented',
    ...extra
  });
}
test('pre-attack attacker roll destruction dispatches Devoted Defense before the next friendly attack',()=>{
  const doomed=sourceSkill2('doomed','헌신방어',{
    instanceId:'doomed',hp:1,maxHp:1,
    coinTech:{sharedTosses:1,stats:{hp:{coin:[{operation:'subtract',multiplier:1,tosses:1}]}}}
  });
  const ally=unit('ally',{instanceId:'ally',ap:1,dp:0,hp:5,maxHp:5,slotIndex:2});
  const target=unit('target',{instanceId:'target',ap:0,dp:0,hp:8,maxHp:8,slotIndex:1});
  const p=player('player',{units:[doomed,ally]});
  const ai=player('ai',{units:[target]});
  const s=state(p,ai,{activeId:'ai',prepared:{player:true,ai:true},rng:()=>0.9});
  s.combatEventQueue=FM._test.createCombatEventQueue();
  s.combatEventDispatcher=FM._test.createCoreCombatEventDispatcher();
  FM.resolveBattle(s);
  const chronologicalLog=s.log.slice().reverse().map(entry=>entry.text);
  const buffIndex=chronologicalLog.findIndex(line=>line.includes('헌신방어!'));
  const attackIndex=chronologicalLog.findIndex(line=>line.includes('ally의')&&line.includes('target (2 피해)'));
  assert.ok(buffIndex>=0,'attacker-side destruction trigger should resolve');
  assert.ok(attackIndex>=0,'the next friendly unit should attack with its buffed AP');
  assert.ok(buffIndex<attackIndex,'destruction trigger must resolve before the next unit attacks');
  assert.equal(s.combatEventQueue.size(),0);
});

function destroyWithDevotedDispatcher(units, doomedId) {
  const p=player('player',{units});
  const ai=player('ai');
  const s=state(p,ai);
  s.combatEventQueue=FM._test.createCombatEventQueue();
  s.combatEventDispatcher=FM._test.createCoreCombatEventDispatcher();
  const doomed=p.units.find(card=>card.instanceId===doomedId);
  FM._test.destroyUnit(s,p,doomed,{cause:'test'});
  FM._test.dispatchPendingCombatEvents(s);
  return {p,s};
}

test('Devoted Defense selects the next physical field slot even when array insertion order differs',()=>{
  const doomed=sourceSkill2('doomed','헌신방어',{instanceId:'doomed',slotIndex:1});
  const slotThree=unit('slot-three',{instanceId:'slot-three',slotIndex:3,ap:2,dp:2,hp:5,maxHp:5});
  const slotTwo=unit('slot-two',{instanceId:'slot-two',slotIndex:2,ap:2,dp:2,hp:5,maxHp:5});
  const {p}=destroyWithDevotedDispatcher([doomed,slotThree,slotTwo],'doomed');
  const chosen=p.units.find(card=>card.instanceId==='slot-two');
  const skipped=p.units.find(card=>card.instanceId==='slot-three');
  assert.equal(chosen.tempAP,1);
  assert.equal(chosen.tempDP,1);
  assert.equal(chosen.tempHP,1);
  assert.equal(chosen.hp,6);
  assert.equal(skipped.tempAP,0);
  assert.equal(skipped.tempDP,0);
  assert.equal(skipped.tempHP,0);
});

test('Devoted Defense does not wrap from the last physical slot to an earlier survivor',()=>{
  const earlier=unit('earlier',{instanceId:'earlier',slotIndex:2,ap:2,dp:2,hp:5,maxHp:5});
  const doomed=sourceSkill2('doomed','헌신방어',{instanceId:'doomed',slotIndex:5});
  const {p}=destroyWithDevotedDispatcher([earlier,doomed],'doomed');
  assert.equal(p.units.length,1);
  assert.equal(p.units[0].tempAP,0);
  assert.equal(p.units[0].tempDP,0);
  assert.equal(p.units[0].tempHP,0);
});

test('Devoted Defense temporary AP, DP and HP bonuses expire at the next preparation phase',()=>{
  const doomed=sourceSkill2('doomed','헌신방어',{instanceId:'doomed',slotIndex:1});
  const ally=unit('ally',{instanceId:'ally',slotIndex:2,ap:2,dp:2,hp:5,maxHp:5});
  const {p,s}=destroyWithDevotedDispatcher([doomed,ally],'doomed');
  assert.deepEqual([ally.tempAP,ally.tempDP,ally.tempHP],[1,1,1]);
  assert.equal(ally.hp,6);
  FM._test.beginPhase(s,'player');
  assert.deepEqual([ally.tempAP,ally.tempDP,ally.tempHP],[0,0,0]);
  assert.equal(ally.hp,5);
});

test('pre-attack defender roll destruction dispatches Devoted Defense before the direct attack',()=>{
  const attacker=unit('attacker',{instanceId:'attacker',ap:3,dp:0,hp:5,maxHp:5,slotIndex:1});
  const doomed=sourceSkill2('doomed','헌신방어',{
    instanceId:'doomed',hp:1,maxHp:1,
    coinTech:{sharedTosses:1,stats:{hp:{coin:[{operation:'subtract',multiplier:1,tosses:1}]}}}
  });
  const ally=unit('defender-ally',{instanceId:'defender-ally',ap:1,dp:0,hp:5,maxHp:5,slotIndex:2});
  const p=player('player',{units:[attacker]});
  const ai=player('ai',{units:[doomed,ally]});
  const s=state(p,ai,{activeId:'ai',prepared:{player:true,ai:true},rng:()=>0.9});
  s.combatEventQueue=FM._test.createCombatEventQueue();
  s.combatEventDispatcher=FM._test.createCoreCombatEventDispatcher();
  FM.resolveBattle(s);
  const chronologicalLog=s.log.slice().reverse().map(entry=>entry.text);
  const buffIndex=chronologicalLog.findIndex(line=>line.includes('헌신방어!'));
  const directIndex=chronologicalLog.findIndex(line=>line.includes('직접 공격!'));
  assert.ok(buffIndex>=0,'defender-side destruction trigger should resolve');
  assert.ok(directIndex>=0,'the attacker should proceed with the now-unblocked direct attack');
  assert.ok(buffIndex<directIndex,'destruction trigger must resolve before the direct attack');
  assert.equal(s.combatEventQueue.size(),0);
});

function combatStats(ap,dp,hp){
  return {ap:{value:ap},dp:{value:dp},hp:{value:hp}};
}

test('source Skill2 Tactical Initiative reduces incoming damage by one at equal or lower attacker level',()=>{
  const attacker=unit('attacker',{instanceId:'atk',level:3});
  const defender=sourceSkill2('defender','기선제압',{instanceId:'def',level:3,hp:5,maxHp:5});
  const p=player('player',{units:[defender]});
  const ai=player('ai',{units:[attacker]});
  const s=state(ai,p);
  const result=FM._test.resolveUnitAttack(s,ai,p,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,2,5)
  });
  assert.equal(result.damage,1);
  assert.equal(defender.hp,4);
});

test('source Skill2 Holy Aura prevents damage when attacker AP is at or below half of defender DP plus HP',()=>{
  const attacker=unit('attacker',{instanceId:'atk',level:4});
  const defender=sourceSkill2('defender','홀리오오라',{instanceId:'def',hp:5,maxHp:5});
  const p=player('player',{units:[defender]});
  const ai=player('ai',{units:[attacker]});
  const s=state(ai,p);
  const result=FM._test.resolveUnitAttack(s,ai,p,attacker,defender,{
    attacker:combatStats(3,0,5),defender:combatStats(2,1,5)
  });
  assert.equal(result.damage,0);
  assert.equal(defender.hp,5);
});

test('source Skill2 Wrath converts actual HP lost while defending into immediate AP',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const defender=sourceSkill2('defender','격노',{instanceId:'def',hp:6,maxHp:6,ap:2,dp:0});
  const p=player('player',{units:[defender]});
  const ai=player('ai',{units:[attacker]});
  const s=state(ai,p);
  const result=FM._test.resolveUnitAttack(s,ai,p,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,0,6)
  });
  assert.equal(result.damage,4);
  assert.equal(defender.hp,2);
  assert.equal(FM.totalPower(defender,'ap'),6);
});

test('source Skill2 Wrath gains AP only for HP actually lost when the defender survives',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const defender=sourceSkill2('defender','격노',{instanceId:'def',hp:3,maxHp:3,ap:1,dp:0});
  const p=player('player',{units:[defender]});
  const ai=player('ai',{units:[attacker]});
  const result=FM._test.resolveUnitAttack(state(ai,p),ai,p,attacker,defender,{
    attacker:combatStats(2,0,5),defender:combatStats(1,0,3)
  });
  assert.equal(result.damage,2);
  assert.equal(result.defenderAlive,true);
  assert.equal(defender.hp,1);
  assert.equal(FM.totalPower(defender,'ap'),3,'Wrath gains only the two HP actually lost');
});

test('source Skill2 Wrath does not gain AP from zero damage or lethal HP loss',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const p=player('player');
  const ai=player('ai');
  const defender=sourceSkill2('defender','격노',{instanceId:'def',hp:2,maxHp:2,ap:2,dp:0});
  p.units.push(defender);
  let s=state(ai,p);
  let result=FM._test.resolveUnitAttack(s,ai,p,attacker,defender,{
    attacker:combatStats(2,0,5),defender:combatStats(4,4,2)
  });
  assert.equal(result.damage,0);
  assert.equal(defender.hp,2);
  assert.equal(FM.totalPower(defender,'ap'),2);

  const lethal=sourceSkill2('lethal-defender','격노',{instanceId:'lethal',hp:2,maxHp:2,ap:2,dp:0});
  const p2=player('player',{units:[lethal]});
  const ai2=player('ai');
  s=state(ai2,p2);
  result=FM._test.resolveUnitAttack(s,ai2,p2,attacker,lethal,{
    attacker:combatStats(4,0,5),defender:combatStats(1,0,2)
  });
  assert.equal(result.defenderAlive,false);
  assert.equal(lethal.hp,0);
  assert.equal(FM.totalPower(lethal,'ap'),2,'Wrath does not apply after lethal damage');
});

test('source Skill2 Devoted Defense buffs the next friendly field unit when the owner is destroyed',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const defender=sourceSkill2('defender','헌신방어',{instanceId:'def',hp:1,maxHp:1,ap:2,dp:1});
  const next=unit('next',{instanceId:'next',hp:4,maxHp:4,ap:3,dp:2});
  const p=player('player',{units:[defender,next]});
  const ai=player('ai',{units:[attacker]});
  const s=state(ai,p);
  const result=FM._test.resolveUnitAttack(s,ai,p,attacker,defender,{
    attacker:combatStats(3,0,5),defender:combatStats(2,1,1)
  });
  assert.equal(result.defenderAlive,false);
  assert.equal(FM.totalPower(next,'ap'),4);
  assert.equal(FM.totalPower(next,'dp'),3);
  assert.equal(next.hp,5);
  assert.equal(next.tempHP,1);
});

test('source Skill2 Alliance Defense reduces damage by each other field unit with the same affiliation',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const defender=sourceSkill2('defender','얼라이디펜스',{instanceId:'def',affiliation:'guild-a'});
  const ally=unit('ally',{instanceId:'ally',affiliation:'guild-a'});
  const unrelated=unit('unrelated',{instanceId:'other',affiliation:'guild-b'});
  const p=player('player',{units:[defender,ally,unrelated]});
  const ai=player('ai',{units:[attacker]});
  const result=FM._test.resolveUnitAttack(state(ai,p),ai,p,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,1,5)
  });
  assert.equal(result.damage,2);
  assert.equal(defender.hp,3);
});

test('source Skill2 Racial Defense reduces damage by each other field unit with the same race',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const defender=sourceSkill2('defender','레이셜디펜스',{instanceId:'def',race:'elf'});
  const ally=unit('ally',{instanceId:'ally',race:'elf'});
  const unrelated=unit('unrelated',{instanceId:'other',race:'orc'});
  const p=player('player',{units:[defender,ally,unrelated]});
  const ai=player('ai',{units:[attacker]});
  const result=FM._test.resolveUnitAttack(state(ai,p),ai,p,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,1,5)
  });
  assert.equal(result.damage,2);
  assert.equal(defender.hp,3);
});

test('source Skill2 Pressure reduces damage by half the number of empty friendly field slots, rounded down',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const defender=sourceSkill2('defender','프레셔',{instanceId:'def',hp:6,maxHp:6});
  const p=player('player',{units:[defender]});
  const ai=player('ai',{units:[attacker]});
  const result=FM._test.resolveUnitAttack(state(ai,p),ai,p,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,0,6)
  });
  assert.equal(result.damage,2);
  assert.equal(defender.hp,4);
});

test('source Skill2 Pressure cannot reduce incoming damage below zero',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const defender=sourceSkill2('defender','프레셔',{instanceId:'def',hp:6,maxHp:6});
  const p=player('player',{units:[defender]});
  const ai=player('ai',{units:[attacker]});
  const result=FM._test.resolveUnitAttack(state(ai,p),ai,p,attacker,defender,{
    attacker:combatStats(1,0,5),defender:combatStats(2,0,6)
  });
  assert.equal(result.damage,0);
  assert.equal(defender.hp,6);
});

test('source Skill2 Strong Devoted Defense buffs every surviving friendly field unit when destroyed',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const defender=sourceSkill2('defender','강한헌신방어',{instanceId:'def',hp:1,maxHp:1,ap:2,dp:1});
  const next=unit('next',{instanceId:'next',hp:4,maxHp:4,ap:3,dp:2});
  const another=unit('another',{instanceId:'another',hp:3,maxHp:3,ap:1,dp:1});
  const p=player('player',{units:[defender,next,another]});
  const ai=player('ai',{units:[attacker]});
  const result=FM._test.resolveUnitAttack(state(ai,p),ai,p,attacker,defender,{
    attacker:combatStats(3,0,5),defender:combatStats(2,1,1)
  });
  assert.equal(result.defenderAlive,false);
  assert.equal(FM.totalPower(next,'ap'),4);
  assert.equal(FM.totalPower(next,'dp'),3);
  assert.equal(next.hp,5);
  assert.equal(FM.totalPower(another,'ap'),2);
  assert.equal(FM.totalPower(another,'dp'),2);
  assert.equal(another.hp,4);
});


test('DB29 1.3 Skill1 mapping metadata fails closed unless manual authority and verified status agree',()=>{
  const normalize=FM._test.normalizeSpecialSkillForEngine;
  const base={specialSkillRuleId:'defense_bypass',specialSkillRuleAuthority:'manual'};
  assert.equal(normalize({...base,specialSkillMappingStatus:'manual_verified'},'방어무시'),'방어무시');
  assert.equal(normalize({...base,specialSkillMappingStatus:'community_documented_candidate'},'방어무시'),'');
  assert.equal(normalize({...base,specialSkillMappingStatus:'unmapped'},'방어무시'),'');
  assert.equal(normalize({...base,specialSkillMappingStatus:'manual_verified',specialSkillRuleAuthority:'community'},'방어무시'),'');
  assert.equal(normalize({...base,specialSkillMappingStatus:'manual_verified',specialSkillRuleId:'not_in_manual_catalog'},'방어무시'),'');
});


test('Manual canonical shield-break label normalizes to the engine keyword',()=>{
  assert.equal(FM._test.normalizeSpecialSkillForEngine({},'방패파괴'),'방패파괴공격');
  assert.equal(FM._test.normalizeSpecialSkillForEngine({},'방패파괴기술'),'방패파괴공격');
});

test('DB29 source-card Skill2 normalization accepts only exact implemented rule/name/authority tuples',()=>{
  const normalize=FM._test.normalizeSpecialSkill2ForEngine;
  const accepted={
    skill2_tactical_initiative:'기선제압',
    skill2_devoted_defense:'헌신방어',
    skill2_frenzy_defense:'격노',
    skill2_holy_aura:'홀리오오라',
    skill2_alliance_defense:'얼라이디펜스',
    skill2_racial_defense:'레이셜디펜스',
    skill2_strong_devoted_defense:'강한헌신방어',
    skill2_pressure_defense:'프레셔'
  };
  assert.equal(Object.keys(FM._test.SKILL2_SOURCE_RULE_NAMES).length,8);
  for(const [ruleId,name] of Object.entries(accepted)){
    const good={specialSkill2:name,specialSkill2MappingStatus:'source_card_verified',
      specialSkill2RuleAuthority:'card_source',specialSkill2ExecutionStatus:'source-card-rule-implemented',
      specialSkill2RuleId:ruleId};
    assert.equal(normalize(good),name,ruleId);
    assert.equal(normalize({...good,specialSkill2:'임의이름'}),'',ruleId+' wrong name');
    assert.equal(normalize({...good,specialSkill2RuleAuthority:'community'}),'',ruleId+' wrong authority');
    assert.equal(normalize({...good,specialSkill2MappingStatus:'community_documented_candidate'}),'',ruleId+' candidate');
    assert.equal(normalize({...good,specialSkill2ExecutionStatus:'not_implemented'}),'',ruleId+' not implemented');
  }
  assert.equal(normalize({specialSkill2:'기선제압',specialSkill2MappingStatus:'source_card_verified',
    specialSkill2RuleAuthority:'card_source',specialSkill2ExecutionStatus:'source-card-rule-implemented',
    specialSkill2RuleId:'unrecognized'}),'');
});


// Boundary regressions for source-card verified Skill2 defenses. These guard
// the rounding and damage-floor semantics rather than only their happy paths.
test('source Skill2 Pressure rounds down with one empty slot and reduces damage with two',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const defender=sourceSkill2('defender','프레셔',{instanceId:'def',hp:6,maxHp:6});
  const oneEmpty=[defender,unit('a',{instanceId:'a'}),unit('b',{instanceId:'b'}),unit('c',{instanceId:'c'})];
  const owner=player('player',{units:oneEmpty});
  const ai=player('ai',{units:[attacker]});
  let result=FM._test.resolveUnitAttack(state(ai,owner),ai,owner,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,0,6)
  });
  assert.equal(result.damage,4,'one empty slot gives floor(1/2)=0 reduction');
  defender.hp=6;
  owner.units=oneEmpty.slice(0,3);
  result=FM._test.resolveUnitAttack(state(ai,owner),ai,owner,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,0,6)
  });
  assert.equal(result.damage,3,'two empty slots give one damage reduction');
});

test('source Skill2 Alliance and Racial Defense never reduce incoming damage below zero',()=>{
  for (const [name,field,value] of [['얼라이디펜스','affiliation','guild-a'],['레이셜디펜스','race','elf']]) {
    const attacker=unit('attacker',{instanceId:'atk'});
    const defender=sourceSkill2('defender',name,{instanceId:'def',[field]:value,hp:5,maxHp:5});
    const allies=Array.from({length:3},(_,i)=>unit('ally'+i,{instanceId:'ally'+i,[field]:value}));
    const owner=player('player',{units:[defender,...allies]});
    const ai=player('ai',{units:[attacker]});
    const result=FM._test.resolveUnitAttack(state(ai,owner),ai,owner,attacker,defender,{
      attacker:combatStats(1,0,5),defender:combatStats(2,1,5)
    });
    assert.equal(result.damage,0,name+' damage floor');
    assert.equal(defender.hp,5,name+' preserves HP');
  }
});

test('source Skill2 Tactical Initiative does not reduce damage when attacker level is higher',()=>{
  const attacker=unit('attacker',{instanceId:'atk',level:4});
  const defender=sourceSkill2('defender','기선제압',{instanceId:'def',level:3,hp:5,maxHp:5});
  const owner=player('player',{units:[defender]});
  const ai=player('ai',{units:[attacker]});
  const result=FM._test.resolveUnitAttack(state(ai,owner),ai,owner,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,1,5)
  });
  assert.equal(result.damage,3);
  assert.equal(defender.hp,2);
});


test('source Skill2 Devoted Defense buffs the unit immediately after the destroyed field position',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const before=unit('before',{instanceId:'before',ap:1,dp:1,hp:3,maxHp:3});
  const defender=sourceSkill2('devoted','헌신방어',{instanceId:'def',hp:1,maxHp:1,ap:2,dp:1});
  const next=unit('next',{instanceId:'next',ap:3,dp:2,hp:4,maxHp:4});
  const owner=player('player',{units:[before,defender,next]});
  const ai=player('ai',{units:[attacker]});
  const result=FM._test.resolveUnitAttack(state(ai,owner),ai,owner,attacker,defender,{
    attacker:combatStats(3,0,5),defender:combatStats(2,1,1)
  });
  assert.equal(result.defenderAlive,false);
  assert.equal(FM.totalPower(before,'ap'),1,'unit before the destroyed slot is unchanged');
  assert.equal(FM.totalPower(next,'ap'),4,'unit after the destroyed slot receives the buff');
  assert.equal(FM.totalPower(next,'dp'),3);
  assert.equal(next.hp,5);
  assert.equal(next.tempHP,1);
});

test('source Skill2 Devoted Defense has no target when the destroyed unit was last on field',()=>{
  const attacker=unit('attacker',{instanceId:'atk'});
  const defender=sourceSkill2('devoted','헌신방어',{instanceId:'def',hp:1,maxHp:1,ap:2,dp:1});
  const owner=player('player',{units:[defender]});
  const ai=player('ai',{units:[attacker]});
  const result=FM._test.resolveUnitAttack(state(ai,owner),ai,owner,attacker,defender,{
    attacker:combatStats(3,0,5),defender:combatStats(2,1,1)
  });
  assert.equal(result.defenderAlive,false);
  assert.equal(owner.units.length,0);
  assert.equal(owner.graveyard.some(card=>card.instanceId==='def'),true);
});


test('combat event records preserve source, cause, target slot and an isolated snapshot',()=>{
  const {createCombatEvent}=FM._test;
  const snapshot={name:'수호자',ap:3,hp:4,equipment:['shield']};
  const event=createCombatEvent('unit_destroyed',{
    ownerId:'player',cause:'combat',source:{instanceId:'src-1',cardId:'card-1'},
    target:{instanceId:'target-1'},fieldIndex:2,snapshot,payload:{destroyed:true}
  });
  snapshot.hp=0;
  assert.equal(event.type,'unit_destroyed');
  assert.equal(event.ownerId,'player');
  assert.equal(event.cause,'combat');
  assert.equal(event.sourceInstanceId,'src-1');
  assert.equal(event.sourceCardId,'card-1');
  assert.equal(event.targetInstanceId,'target-1');
  assert.equal(event.targetCardId,null);
  assert.equal(event.fieldIndex,2);
  assert.equal(event.snapshot.hp,4,'event snapshot is isolated from later board mutation');
  assert.deepEqual(event.payload,{destroyed:true});
  assert.equal(Object.isFrozen(event),true,'event envelope is immutable');
  assert.equal(Object.isFrozen(event.snapshot),true,'nested snapshot is immutable');
  assert.equal(Object.isFrozen(event.snapshot.equipment),true,'nested arrays are immutable');
  assert.throws(()=>createCombatEvent('',{}),TypeError);
});

test('combat event queue preserves deterministic insertion order and drains once',()=>{
  const {createCombatEvent,createCombatEventQueue}=FM._test;
  const queue=createCombatEventQueue();
  const first=createCombatEvent('unit_destroyed',{fieldIndex:1,snapshot:{hp:0}});
  const second=createCombatEvent('unit_summoned',{fieldIndex:1,snapshot:{hp:5}});
  queue.enqueue(first);
  queue.enqueue(second);
  first.snapshot.hp=99;
  assert.equal(queue.size(),2);
  const drained=queue.drain();
  assert.deepEqual(drained.map(event=>event.type),['unit_destroyed','unit_summoned']);
  assert.deepEqual(drained.map(event=>event.sequence),[0,1]);
  assert.equal(drained[0].snapshot.hp,0,'queued event is isolated from caller mutation');
  assert.equal(Object.isFrozen(first),true,'queued source event remains frozen');
  assert.equal(Object.isFrozen(first.snapshot),true,'queued source snapshot remains frozen');
  assert.equal(queue.size(),0);
  assert.deepEqual(queue.drain(),[]);
});


test('zone transfer moves the exact card and preserves source order',()=>{const {transferCardBetweenZones}=FM._test;const a={instanceId:'a'},b={instanceId:'b'},c={instanceId:'c'};const source=[a,b,c],destination=[];const result=transferCardBetweenZones(source,destination,'b');assert.equal(result.ok,true);assert.equal(result.card,b);assert.equal(result.sourceIndex,1);assert.deepEqual(source,[a,c]);assert.deepEqual(destination,[b]);});
test('zone transfer rejects missing cards and full destinations without mutation',()=>{const {transferCardBetweenZones}=FM._test;const a={instanceId:'a'},b={instanceId:'b'};const source=[a],destination=[b];const missing=transferCardBetweenZones(source,destination,'missing');assert.equal(missing.ok,false);assert.equal(missing.reason,'card_not_in_source');const full=transferCardBetweenZones(source,destination,'a',{maxDestinationSize:1});assert.equal(full.ok,false);assert.equal(full.reason,'destination_full');assert.deepEqual(source,[a]);assert.deepEqual(destination,[b]);});


test('unit destruction emits one card-local event with a pre-transfer snapshot and cause',()=>{
  const p=player('player');
  const target=unit('fallen',{instanceId:'fallen-1',ap:4,dp:2,hp:0,maxHp:5,equipmentCards:[{instanceId:'item-1',id:'item-card',name:'방패'}]});
  p.units.push(target);
  const s=state(p,player('ai'));
  FM._test.destroyUnit(s,p,target,{cause:'combat',source:{instanceId:'attacker-1',id:'attacker-card'}});
  assert.equal(p.units.length,0);
  assert.equal(p.graveyard[0].instanceId,'fallen-1');
  assert.equal(s.combatEventQueue.size(),1);
  const [event]=s.combatEventQueue.drain();
  assert.equal(event.type,'unit_destroyed');
  assert.equal(event.ownerId,'player');
  assert.equal(event.cause,'combat');
  assert.equal(event.sourceInstanceId,'attacker-1');
  assert.equal(event.targetInstanceId,'fallen-1');
  assert.equal(event.fieldIndex,0);
  assert.equal(event.snapshot.unit.hp,0);
  assert.deepEqual(event.snapshot.equipment,[{instanceId:'item-1',cardId:'item-card',name:'방패'}]);
  assert.equal(event.payload.equipmentCount,1);
  assert.equal(s.combatEventQueue.size(),0);
});

test('failed zone transfer does not emit a unit destruction event',()=>{
  const p=player('player');
  const target=unit('fallen',{instanceId:'fallen-2',hp:0});
  p.units.push(target);
  p.graveyard= null;
  const s=state(p,player('ai'));
  FM._test.destroyUnit(s,p,target,{cause:'combat'});
  assert.equal(p.units.length,1,'unit remains in its source zone when transfer validation fails');
  assert.equal(s.combatEventQueue?.size() || 0,0);
});


test('unit attack emits a resolved event with source, target and actual HP damage',()=>{
  const attacker=unit('attacker',{instanceId:'attack-a',ap:3});
  const defender=unit('defender',{instanceId:'attack-d',dp:1,hp:8,maxHp:8,slotIndex:0});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:3},dp:{value:0},hp:{value:10}},
    defender:{ap:{value:1},dp:{value:1},hp:{value:8}}
  });
  assert.equal(result.damage,2);
  const [event]=s.combatEventQueue.drain();
  assert.equal(event.type,'unit_attack_resolved');
  assert.equal(event.ownerId,'player');
  assert.equal(event.cause,'combat');
  assert.equal(event.sourceInstanceId,'attack-a');
  assert.equal(event.targetInstanceId,'attack-d');
  assert.equal(event.fieldIndex,0);
  assert.equal(event.payload.damage,2);
  assert.equal(event.payload.direct,false);
  assert.equal(event.payload.defenderAlive,true);
});

test('destroying a defender emits destruction before the enclosing attack-resolved event',()=>{
  const attacker=unit('attacker',{instanceId:'kill-a',ap:3});
  const defender=unit('defender',{instanceId:'kill-d',dp:0,hp:2,maxHp:2,slotIndex:0});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:3},dp:{value:0},hp:{value:10}},
    defender:{ap:{value:1},dp:{value:0},hp:{value:2}}
  });
  const events=s.combatEventQueue.drain();
  assert.deepEqual(events.map(event=>event.type),['unit_destroyed','unit_attack_resolved']);
  assert.equal(events[0].sourceInstanceId,'kill-a');
  assert.equal(events[0].targetInstanceId,'kill-d');
  assert.equal(events[0].cause,'combat');
  assert.equal(events[1].payload.damage,2);
  assert.equal(events[1].payload.defenderAlive,false);
});

test('direct attack emits a resolved event without a unit target',()=>{
  const attacker=unit('attacker',{instanceId:'direct-a',cost:{forest:2},ap:3});
  const p=player('player',{units:[attacker]}),ai=player('ai',{deck:[{id:'d1'},{id:'d2'},{id:'d3'}]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,null,{
    attacker:{ap:{value:3},dp:{value:0},hp:{value:10}},defender:null
  });
  assert.equal(result.damage,2);
  const [event]=s.combatEventQueue.drain();
  assert.equal(event.type,'unit_attack_resolved');
  assert.equal(event.sourceInstanceId,'direct-a');
  assert.equal(event.targetInstanceId,null);
  assert.equal(event.payload.direct,true);
  assert.equal(event.payload.damage,2);
  assert.equal(event.payload.invalidCost,false);
});


test('combat event dispatcher rejects unverified and unknown rules fail-closed',()=>{
  const dispatcher=FM._test.createCombatEventDispatcher();
  const candidate=dispatcher.register({
    ruleId:'defense_bypass',mappingStatus:'community_candidate',authority:'community',
    eventTypes:['unit_attack_resolved']
  },()=>true);
  assert.equal(candidate.ok,false);
  assert.equal(candidate.reason,'rule_not_verified_or_not_implemented');
  const unknown=dispatcher.register({
    ruleId:'invented_rule',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_attack_resolved']
  },()=>true);
  assert.equal(unknown.ok,false);
  assert.equal(dispatcher.subscriberCount(),0);
});

test('combat event dispatcher accepts only known verified mappings and dispatches isolated events in order',()=>{
  const dispatcher=FM._test.createCombatEventDispatcher(),seen=[];
  const manual=dispatcher.register({
    ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_attack_resolved']
  },(event,context)=>{seen.push(['manual',event.sequence,context.turn]);event.payload.damage=999;return 'manual-ok';});
  const source=dispatcher.register({
    ruleId:'skill2_tactical_initiative',mappingStatus:'source_card_verified',
    authority:'card_source',executionStatus:'source-card-rule-implemented',
    eventTypes:['unit_attack_resolved']
  },(event,context)=>{seen.push(['source',event.sequence,context.turn]);return 'source-ok';});
  assert.equal(manual.ok,true);
  assert.equal(source.ok,true);
  assert.equal(dispatcher.subscriberCount(),2);
  const duplicate=dispatcher.register({
    ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_attack_resolved']
  },()=>null);
  assert.equal(duplicate.ok,false);
  assert.equal(duplicate.reason,'duplicate_rule_subscription');
  const existing=dispatcher.register({
    ruleId:'ability_seal',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_attack_resolved']
  },()=>null);
  assert.equal(existing.ok,true);
  const partial=dispatcher.register({
    ruleId:'ability_seal',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_summoned','unit_attack_resolved']
  },()=>null);
  assert.equal(partial.ok,false);
  assert.equal(partial.reason,'duplicate_rule_subscription');
  assert.equal(dispatcher.subscriberCount(),3,'failed multi-event registration must not leave a partial subscriber');
  assert.deepEqual(dispatcher.dispatch(FM._test.createCombatEvent('unit_summoned'),{}),[]);
  const queue=FM._test.createCombatEventQueue();
  queue.enqueue(FM._test.createCombatEvent('unit_attack_resolved',{payload:{damage:2}}));
  queue.enqueue(FM._test.createCombatEvent('unit_attack_resolved',{payload:{damage:3}}));
  const original=queue.drain();
  const results=dispatcher.dispatch(original,{turn:7});
  assert.deepEqual(seen,[['manual',0,7],['source',0,7],['manual',1,7],['source',1,7]]);
  assert.deepEqual(results.map(x=>x.ruleId),['defense_bypass','skill2_tactical_initiative','ability_seal','defense_bypass','skill2_tactical_initiative','ability_seal']);
  assert.deepEqual(original.map(x=>x.payload.damage),[2,3],'subscriber mutations must not alter queued source events');
});


test('attached dispatcher drains combat events only at completed attack boundaries',()=>{
  const attacker=unit('attacker',{instanceId:'flush-a',ap:3});
  const defender=unit('defender',{instanceId:'flush-d',dp:1,hp:8,maxHp:8});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const dispatcher=FM._test.createCombatEventDispatcher(),seen=[];
  assert.equal(FM._test.attachCombatEventDispatcher(s,dispatcher),true);
  dispatcher.register({
    ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_attack_resolved']
  },event=>{seen.push(event.type+':'+event.payload.damage);return true;});
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:3},dp:{value:0},hp:{value:10}},
    defender:{ap:{value:1},dp:{value:1},hp:{value:8}}
  });
  assert.deepEqual(seen,['unit_attack_resolved:2']);
  assert.equal(s.combatEventQueue.size(),0);
});

test('events enqueued by a subscriber wait for the next explicit dispatch boundary',()=>{
  const s=state(player('player'),player('ai'));
  const dispatcher=FM._test.createCombatEventDispatcher(),seen=[];
  FM._test.attachCombatEventDispatcher(s,dispatcher);
  dispatcher.register({
    ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_attack_resolved']
  },(event,context)=>{
    seen.push('attack');
    context.state.combatEventQueue.enqueue(FM._test.createCombatEvent('unit_destroyed',{payload:{nested:true}}));
    assert.deepEqual(FM._test.dispatchPendingCombatEvents(context.state),[],
      'reentrant dispatch is blocked until the current event batch completes');
  });
  dispatcher.register({
    ruleId:'skill2_tactical_initiative',mappingStatus:'source_card_verified',
    authority:'card_source',executionStatus:'source-card-rule-implemented',
    eventTypes:['unit_destroyed']
  },event=>{seen.push('destroyed');});
  s.combatEventQueue=FM._test.createCombatEventQueue();
  s.combatEventQueue.enqueue(FM._test.createCombatEvent('unit_attack_resolved',{payload:{damage:1}}));
  FM._test.dispatchPendingCombatEvents(s);
  assert.deepEqual(seen,['attack']);
  assert.equal(s.combatEventQueue.size(),1,'new events are not recursively dispatched in the same drain');
  FM._test.dispatchPendingCombatEvents(s);
  assert.deepEqual(seen,['attack','destroyed']);
  assert.equal(s.combatEventQueue.size(),0);
});


test('spell effect transaction dispatches its destruction event after applying the effect',()=>{
  const p=player('player'),aiTarget=unit('effect-target',{instanceId:'effect-target-1',hp:3,maxHp:3});
  const ai=player('ai',{units:[aiTarget]}),s=state(p,ai),seen=[];
  const dispatcher=FM._test.createCombatEventDispatcher();
  FM._test.attachCombatEventDispatcher(s,dispatcher);
  dispatcher.register({
    ruleId:'skill2_devoted_defense',mappingStatus:'source_card_verified',
    authority:'card_source',executionStatus:'source-card-rule-implemented',
    eventTypes:['unit_destroyed']
  },event=>{seen.push({type:event.type,cause:event.cause,target:event.targetInstanceId});});
  FM._test.applyEffect(s,'player',{type:'damage',target:'enemyUnit',amount:3},aiTarget);
  assert.equal(ai.units.length,0);
  assert.deepEqual(seen,[{type:'unit_destroyed',cause:'effect',target:'effect-target-1'}]);
  assert.equal(s.combatEventQueue.size(),0);
});


test('newGame initializes a per-match dispatcher and routes completed attack events through it',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  assert.equal(typeof s.combatEventDispatcher.dispatchPending,'function');
  const p=s.players.player,ai=s.players.ai;
  const attacker=unit('production-attacker',{instanceId:'production-a',ap:3});
  const defender=unit('production-defender',{instanceId:'production-d',dp:1,hp:5,maxHp:5});
  p.units.push(attacker);ai.units.push(defender);
  const seen=[];
  s.combatEventDispatcher.register({
    ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_attack_resolved']
  },event=>seen.push({type:event.type,damage:event.payload.damage}));
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:3},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:1},dp:{value:1},hp:{value:5}}
  });
  assert.deepEqual(seen,[{type:'unit_attack_resolved',damage:2}]);
  assert.equal(s.combatEventQueue.size(),0);
});


test('production dispatcher applies verified Devoted Defense from the destroyed-unit event',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'core-atk'});
  const defender=sourceSkill2('defender','헌신방어',{instanceId:'core-def',hp:1,maxHp:1,dp:0});
  const next=unit('next',{instanceId:'core-next',hp:4,maxHp:4,ap:3,dp:2});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(attacker);ai.units.push(defender,next);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:combatStats(3,0,5),defender:combatStats(2,0,1)
  });
  assert.equal(result.defenderAlive,false);
  assert.equal(FM.totalPower(next,'ap'),4);
  assert.equal(FM.totalPower(next,'dp'),3);
  assert.equal(next.hp,5);
  assert.equal(next.tempHP,1);
  assert.equal(s.combatEventQueue.size(),0);
});

test('production dispatcher applies Strong Devoted Defense to all survivors',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'strong-atk'});
  const defender=sourceSkill2('defender','강한헌신방어',{instanceId:'strong-def',hp:1,maxHp:1,dp:0});
  const first=unit('first',{instanceId:'strong-first',hp:4,maxHp:4});
  const second=unit('second',{instanceId:'strong-second',hp:5,maxHp:5});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(attacker);ai.units.push(defender,first,second);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:combatStats(3,0,5),defender:combatStats(2,0,1)
  });
  for(const ally of [first,second]){
    assert.equal(FM.totalPower(ally,'ap'),4);
    assert.equal(FM.totalPower(ally,'dp'),3);
    assert.equal(ally.tempHP,1);
  }
  assert.equal(s.combatEventQueue.size(),0);
});

test('production Strong Devoted Defense buffs only surviving friendly field units and excludes enemy units',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'strong-boundary-atk'});
  const defender=sourceSkill2('defender','강한헌신방어',{
    instanceId:'strong-boundary-def',hp:1,maxHp:1,ap:5,dp:2
  });
  const survivor=unit('survivor',{instanceId:'strong-boundary-survivor',hp:4,maxHp:4,ap:2,dp:1});
  const second=unit('second',{instanceId:'strong-boundary-second',hp:3,maxHp:3,ap:1,dp:0});
  const enemy=unit('enemy',{instanceId:'strong-boundary-enemy',hp:5,maxHp:5,ap:4,dp:3});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(attacker,enemy); ai.units.push(defender,survivor,second);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:combatStats(3,0,5),defender:combatStats(2,0,1)
  });
  for(const ally of [survivor,second]){
    assert.equal(FM.totalPower(ally,'ap'),ally.ap+1);
    assert.equal(FM.totalPower(ally,'dp'),ally.dp+1);
    assert.equal(ally.tempHP,1);
  }
  assert.equal(FM.totalPower(enemy,'ap'),4);
  assert.equal(FM.totalPower(enemy,'dp'),3);
  assert.equal(enemy.tempHP||0,0);
  assert.equal(s.combatEventQueue.size(),0);
});


test('production Skill2 dispatcher remains fail-closed for inferred card mappings',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'inferred-atk'});
  const defender=unit('defender',{
    instanceId:'inferred-def',hp:1,maxHp:1,dp:0,specialSkill2:'헌신방어',
    specialSkill2RuleId:'skill2_devoted_defense',specialSkill2MappingStatus:'inferred',
    specialSkill2RuleAuthority:'card_source',specialSkill2ExecutionStatus:'source-card-rule-implemented'
  });
  const next=unit('next',{instanceId:'inferred-next',hp:4,maxHp:4,ap:3,dp:2});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(attacker);ai.units.push(defender,next);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:combatStats(3,0,5),defender:combatStats(2,0,1)
  });
  assert.equal(FM.totalPower(next,'ap'),3);
  assert.equal(FM.totalPower(next,'dp'),2);
  assert.equal(next.tempHP||0,0);
  assert.equal(s.combatEventQueue.size(),0);
});


test('production dispatcher applies Alliance and Racial Defense through pre-damage events',()=>{
  for (const [name,field,value] of [['얼라이디펜스','affiliation','guild-x'],['레이셜디펜스','race','elf']]) {
    const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
    const attacker=unit('attacker',{instanceId:'mod-atk'});
    const defender=sourceSkill2('defender',name,{instanceId:'mod-def',hp:5,maxHp:5,dp:1,[field]:value});
    const allies=[0,1].map(i=>unit('ally'+i,{instanceId:'mod-ally'+i,[field]:value}));
    const p=s.players.player,ai=s.players.ai;
    p.units.push(attacker);ai.units.push(defender,...allies);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:combatStats(4,0,5),defender:combatStats(2,1,5)
    });
    assert.equal(result.damage,1,name+' subtracts two matching allies from raw damage 3');
    assert.equal(defender.hp,4);
    // Event queue contents are independent of the HP-floor invariant.
  }
});

test('production Alliance Defense counts only other matching friendly field units and ignores missing or enemy affiliations',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'alliance-boundary-atk'});
  const defender=sourceSkill2('defender','얼라이디펜스',{
    instanceId:'alliance-boundary-def',hp:8,maxHp:8,dp:0,affiliation:'guild-a'
  });
  const matching=unit('matching',{instanceId:'alliance-boundary-match',affiliation:'guild-a'});
  const mismatched=unit('mismatched',{instanceId:'alliance-boundary-mismatch',affiliation:'guild-b'});
  const missing=unit('missing',{instanceId:'alliance-boundary-missing'});
  const enemyMatching=unit('enemy-matching',{instanceId:'alliance-enemy-match',affiliation:'guild-a'});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(defender,matching,mismatched,missing);
  ai.units.push(attacker,enemyMatching);
  const result=FM._test.resolveUnitAttack(s,ai,p,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(1,0,8)
  });
  assert.equal(result.damage,3,'only one other friendly unit with the exact affiliation reduces raw damage 4');
  assert.equal(defender.hp,5);
  assert.equal(enemyMatching.hp,5,'enemy-side affiliation does not contribute to defending-side count');
});

test('production Alliance Defense gives no reduction when the defender has no affiliation',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'alliance-empty-atk'});
  const defender=sourceSkill2('defender','얼라이디펜스',{
    instanceId:'alliance-empty-def',hp:8,maxHp:8,dp:0,affiliation:''
  });
  const ally=unit('ally',{instanceId:'alliance-empty-ally',affiliation:'guild-a'});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(defender,ally); ai.units.push(attacker);
  const result=FM._test.resolveUnitAttack(s,ai,p,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(1,0,8)
  });
  assert.equal(result.damage,4);
  assert.equal(defender.hp,4);
});

test('production dispatcher applies Pressure Defense from empty friendly slots',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'pressure-atk'});
  const defender=sourceSkill2('defender','프레셔',{instanceId:'pressure-def',hp:6,maxHp:6,dp:1});
  const ally=unit('ally',{instanceId:'pressure-ally'});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(attacker);ai.units.push(defender,ally);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,1,6)
  });
  assert.equal(result.damage,2,'three empty slots produce floor(3/2)=1 reduction');
  assert.equal(defender.hp,4);
});

test('production Pressure Defense respects the five-slot floor boundary',()=>{
  // Defender plus fillers make 0, 1, 2, or 3 empty slots. Pressure reduces
  // by floor(empty slots / 2), and must never invent a reduction at 0 or 1.
  for (const [fieldUnits,expected] of [[5,3],[4,3],[3,2],[2,2]]) {
    const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
    const attacker=unit('attacker',{instanceId:'pressure-boundary-atk-'+fieldUnits});
    const defender=sourceSkill2('defender','프레셔',{
      instanceId:'pressure-boundary-def-'+fieldUnits,hp:6,maxHp:6,dp:1
    });
    const fillers=Array.from({length:fieldUnits-1},(_,i)=>unit('filler'+i,{
      instanceId:'pressure-boundary-fill-'+fieldUnits+'-'+i
    }));
    const p=s.players.player,ai=s.players.ai;
    p.units.push(attacker);ai.units.push(defender,...fillers);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:combatStats(4,0,5),defender:combatStats(2,1,6)
    });
    assert.equal(result.damage,expected,'field unit count '+fieldUnits);
    assert.equal(defender.hp,6-expected);
  }
});
 
test('production Pressure Defense counts unique visible slots when fallback and explicit slot indices collide',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'pressure-slot-collision-atk'});
  const fallbackSlot=unit('fallback-slot',{instanceId:'pressure-slot-collision-fallback'});
  const defender=sourceSkill2('defender','프레셔',{
    instanceId:'pressure-slot-collision-def',slotIndex:1,hp:6,maxHp:6,dp:1
  });
  const p=s.players.player,ai=s.players.ai;
  p.units.push(attacker);ai.units.push(fallbackSlot,defender);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,1,6)
  });
  // app.js renders the fallback unit at slot 1, then the explicit slot-1
  // defender overwrites it in the slot map: only one physical slot is occupied.
  assert.equal(result.damage,1,'four visible empty slots reduce damage by floor(4/2)=2');
  assert.equal(defender.hp,5);
});

test('production Pressure Defense ignores units outside the five rendered field slots',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'pressure-outside-slot-atk'});
  const defender=sourceSkill2('defender','프레셔',{
    instanceId:'pressure-outside-slot-def',slotIndex:1,hp:6,maxHp:6,dp:1
  });
  const outside=unit('outside',{instanceId:'pressure-outside-slot-unit',slotIndex:6});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(attacker);ai.units.push(defender,outside);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,1,6)
  });
  assert.equal(result.damage,1,'slot 6 is outside the five-slot field and must not count as occupied');
  assert.equal(defender.hp,5);
});


test('production Pressure Defense applies floor(4/2) at the four-empty-slot boundary',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'pressure-four-empty-atk'});
  const defender=sourceSkill2('defender','프레셔',{
    instanceId:'pressure-four-empty-def',hp:6,maxHp:6,dp:1
  });
  const p=s.players.player,ai=s.players.ai;
  p.units.push(attacker);
  ai.units.push(defender);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,1,6)
  });
  assert.equal(result.damage,1,'four empty slots produce floor(4/2)=2 damage reduction');
  assert.equal(defender.hp,5);
  assert.equal(s.combatEventQueue.size(),0);
});

test('production dispatcher applies Wrath from actual HP lost before retaliation',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'wrath-atk'});
  const defender=sourceSkill2('defender','격노',{instanceId:'wrath-def',hp:5,maxHp:5,dp:1});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(attacker);ai.units.push(defender);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,1,5)
  });
  assert.equal(result.damage,3);
  assert.equal(defender.hp,2);
  assert.equal(FM.totalPower(defender,'ap'),6);
  assert.equal(defender.tempAP,3);
});

test('production defensive handlers ignore inferred Alliance Defense mappings',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'inferred-alliance-atk'});
  const defender=unit('defender',{instanceId:'inferred-alliance-def',hp:5,maxHp:5,dp:1,
    affiliation:'guild-x',specialSkill2:'얼라이디펜스',specialSkill2RuleId:'skill2_alliance_defense',
    specialSkill2MappingStatus:'inferred',specialSkill2RuleAuthority:'card_source',
    specialSkill2ExecutionStatus:'source-card-rule-implemented'});
  const allies=[0,1].map(i=>unit('ally'+i,{instanceId:'inferred-alliance-ally'+i,affiliation:'guild-x'}));
  const p=s.players.player,ai=s.players.ai;
  p.units.push(attacker);ai.units.push(defender,...allies);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(2,1,5)
  });
  assert.equal(result.damage,3);
  assert.equal(defender.hp,2);
});


test('production dispatcher applies Tactical Initiative through a verified pre-damage event',()=>{
  for (const [attackerLevel,expected] of [[3,2],[4,2],[5,3]]) {
    const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
    const attacker=unit('attacker',{instanceId:'ti-atk-'+attackerLevel,level:attackerLevel});
    const defender=sourceSkill2('defender','기선제압',{
      instanceId:'ti-def-'+attackerLevel,level:4,dp:1,hp:6,maxHp:6
    });
    const p=s.players.player,ai=s.players.ai;
    p.units.push(attacker);ai.units.push(defender);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:combatStats(4,0,5),defender:combatStats(2,1,6)
    });
    assert.equal(result.damage,expected,'attacker level '+attackerLevel+' vs defender level 4');
    assert.equal(defender.hp,6-expected);
    // Event queue contents are independent of the HP-floor invariant.
  }
});

test('production dispatcher applies Holy Aura using floor of rolled DP plus current HP',()=>{
  for (const [attackAP,expectedDamage] of [[3,0],[4,2]]) {
    const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
    const attacker=unit('attacker',{instanceId:'holy-atk-'+attackAP});
    const defender=sourceSkill2('defender','홀리오오라',{
      instanceId:'holy-def-'+attackAP,hp:5,maxHp:5,dp:2
    });
    const p=s.players.player,ai=s.players.ai;
    p.units.push(attacker);ai.units.push(defender);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:combatStats(attackAP,0,5),defender:combatStats(2,2,5)
    });
    assert.equal(result.damage,expectedDamage,'attack AP '+attackAP+' against floor((2+5)/2)=3');
    assert.equal(defender.hp,5-expectedDamage);
    assert.equal(s.combatEventQueue.size(),0);
  }
});

test('production Tactical Initiative and Holy Aura do not activate from inferred mappings',()=>{
  for (const [skill,ruleId] of [['기선제압','skill2_tactical_initiative'],['홀리오오라','skill2_holy_aura']]) {
    const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
    const attacker=unit('attacker',{instanceId:'inferred-'+ruleId,level:4});
    const defender=unit('defender',{instanceId:'inferred-def-'+ruleId,level:4,dp:2,hp:5,maxHp:5,
      specialSkill2:skill,specialSkill2RuleId:ruleId,specialSkill2MappingStatus:'inferred',
      specialSkill2RuleAuthority:'card_source',specialSkill2ExecutionStatus:'source-card-rule-implemented'});
    const p=s.players.player,ai=s.players.ai;
    p.units.push(attacker);ai.units.push(defender);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:combatStats(3,0,5),defender:combatStats(2,2,5)
    });
    assert.equal(result.damage,1,'inferred '+skill+' must not reduce or prevent damage');
    assert.equal(defender.hp,4);
  }
});


// Batched dispatcher contract tests: registration gate, duplicate protection,
// event fan-out isolation and card-local source tuple validation.
test('combat dispatcher rejects unverified authority, duplicate event types, and duplicate subscriptions',()=>{
  const dispatcher=FM._test.createCombatEventDispatcher();
  const handler=()=>({ok:true});
  const manual={ruleId:'defense_bypass',mappingStatus:'manual_verified',authority:'manual',
    eventTypes:['unit_destroyed']};
  assert.equal(dispatcher.register({...manual,authority:'community'},handler).reason,
    'rule_not_verified_or_not_implemented');
  assert.equal(dispatcher.register({...manual,eventTypes:['unit_destroyed','unit_destroyed']},handler).reason,
    'invalid_event_types');
  assert.equal(dispatcher.register(manual,handler).ok,true);
  assert.equal(dispatcher.register(manual,handler).reason,'duplicate_rule_subscription');
  assert.equal(dispatcher.subscriberCount(),1);
});

test('combat dispatcher sends isolated event copies to every subscriber in stable order',()=>{
  const dispatcher=FM._test.createCombatEventDispatcher();
  const seen=[];
  for(const ruleId of ['defense_bypass','fatal_attack']){
    assert.equal(dispatcher.register({ruleId,mappingStatus:'manual_verified',authority:'manual',
      eventTypes:['unit_destroyed']},event=>{
        seen.push(ruleId);
        event.snapshot.unit.hp=999;
        return {observed:ruleId};
      }).ok,true);
  }
  const event=FM._test.createCombatEvent('unit_destroyed',{sequence:12,snapshot:{unit:{hp:0}}});
  const result=dispatcher.dispatch(event,{});
  assert.deepEqual(seen,['defense_bypass','fatal_attack']);
  assert.deepEqual(result.map(item=>item.ruleId),seen);
  assert.equal(event.snapshot.unit.hp,0,'handler mutation must not leak to source event');
  assert.deepEqual(result.map(item=>item.sequence),[null,null], 'unsequenced event records retain null sequence until queued');
});

test('Skill2 dispatcher requires exact card-source rule tuple and canonical name',()=>{
  const dispatcher=FM._test.createCombatEventDispatcher();
  let calls=0;
  const rule={ruleId:'skill2_devoted_defense',mappingStatus:'source_card_verified',
    authority:'card_source',executionStatus:'source-card-rule-implemented',
    eventTypes:['unit_destroyed'],sourceMatch:'skill2'};
  assert.equal(dispatcher.register(rule,()=>{calls++;return {applied:true};}).ok,true);
  const eventFor=(unit)=>FM._test.createCombatEvent('unit_destroyed',{
    source:{cardId:'unrelated-destroyer'},target:unit,snapshot:{unit}
  });
  const base={id:'devoted-defense-source-card',cardId:'devoted-defense-source-card',specialSkill2:'헌신방어',specialSkill2RuleId:'skill2_devoted_defense',
    specialSkill2MappingStatus:'source_card_verified',specialSkill2RuleAuthority:'card_source',
    specialSkill2ExecutionStatus:'source-card-rule-implemented'};
  dispatcher.dispatch([
    eventFor({...base,skill2:'헌신방어'}),
    eventFor({...base,skill2:'헌신방어',specialSkill2RuleAuthority:'community'}),
    eventFor({...base,skill2:'헌신방어',specialSkill2MappingStatus:'inferred'}),
    eventFor({...base,skill2:'다른기술'}),
    eventFor({...base,skill2:'헌신방어',specialSkill2RuleId:'unknown'})
  ],{});
  assert.equal(calls,1,'only the exact canonical source tuple is allowed through');
});

test('compact DB29 Skill1 mapping executes only source-authorized Manual rules in combat',()=>{
  const run=(mapping={})=>{
    const a=unit('compact-a',{instanceId:'compact-a',skill:'방어무시공격기술',ap:2,
      specialSkillRuleId:'defense_bypass',specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual',...mapping});
    const d=unit('compact-d',{instanceId:'compact-d',dp:5,hp:10,maxHp:10});
    const p=player('player',{units:[a]}),ai=player('ai',{units:[d]}),s=state(p,ai);
    const rolls={
      attacker:{ap:{value:2},dp:{value:0},hp:{value:10}},
      defender:{ap:{value:0},dp:{value:5},hp:{value:10}}
    };
    FM._test.resolveUnitAttack(s,p,ai,a,d,rolls);
    return d.hp;
  };

  assert.equal(run(),8,'DB29 compact manual mapping applies defense-bypass AP directly to HP');
  assert.equal(run({specialSkillRuleAuthority:'community'}),10,
    'same rule ID with non-manual authority must fail closed to ordinary attack');
  assert.equal(run({specialSkillMappingStatus:'community_candidate',
    specialSkillRuleAuthority:'community'}),10,
    'community candidate metadata must not activate the Manual handler');
});


test('compact DB29 Manual defense-bypass Skill1 clamps zero attack power and preserves target HP',()=>{
  const a=unit('compact-zero-a',{instanceId:'compact-zero-a',skill:'방어무시공격기술',ap:0,
    specialSkillRuleId:'defense_bypass',specialSkillMappingStatus:'manual_verified',
    specialSkillRuleAuthority:'manual'});
  const d=unit('compact-zero-d',{instanceId:'compact-zero-d',dp:7,hp:3,maxHp:3});
  const p=player('player',{units:[a]}),ai=player('ai',{units:[d]}),s=state(p,ai);
  const rolls={
    attacker:{ap:{value:0},dp:{value:0},hp:{value:3}},
    defender:{ap:{value:0},dp:{value:7},hp:{value:3}}
  };
  const result=FM._test.resolveUnitAttack(s,p,ai,a,d,rolls);
  assert.equal(result.damage,0,'zero AP cannot cause negative or fabricated damage');
  assert.equal(d.hp,3,'defense bypass skips DP, not the zero-damage clamp');
  // Attack resolution enqueues a combat event; queue emptiness is not part of the damage invariant.
});


test('compact DB29 Manual fatal attack preserves the one-HP floor at lethal boundary',()=>{
  for (const [targetHp,expectedDamage,expectedHp] of [[1,0,1],[2,1,1],[5,4,1]]) {
    const a=unit('fatal-a-'+targetHp,{instanceId:'fatal-a-'+targetHp,skill:'치명공격기술',ap:3,
      specialSkillRuleId:'fatal_attack',specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual'});
    const d=unit('fatal-d-'+targetHp,{instanceId:'fatal-d-'+targetHp,dp:9,hp:targetHp,maxHp:targetHp});
    const p=player('player',{units:[a]}),ai=player('ai',{units:[d]}),s=state(p,ai);
    const rolls={attacker:{ap:{value:3},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:0},dp:{value:9},hp:{value:targetHp}}};
    const result=FM._test.resolveUnitAttack(s,p,ai,a,d,rolls);
    assert.equal(result.damage,expectedDamage,'target starts at '+targetHp+' HP');
    assert.equal(d.hp,expectedHp,'fatal attack leaves the target at one HP');
  }
});

test('DB29 Manual Fatal Attack source card respects HP decrease markers',()=>{
  const run=(hpMarker='')=>{
    const attacker=db29ManualSkill1('10012024612','선더골렘','치명공격','fatal_attack',{
      ap:3,dp:0,hp:5,maxHp:5
    });
    const defender=unit('fatal-marker-target',{
      instanceId:'fatal-marker-target-'+(hpMarker||'none'),
      ap:0,dp:9,hp:5,maxHp:5,
      statMarkers:hpMarker?{hp:hpMarker}:{}
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:3},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:0},dp:{value:9},hp:{value:5}}
    });
    return {defender,result};
  };

  // Manual specialability.htm §3 sets the target to 1 HP; cardability.htm
  // stat markers govern whether that HP decrease can be applied.
  let x=run();
  assert.equal(x.result.damage,4);
  assert.equal(x.defender.hp,1);

  x=run('▽');
  assert.equal(x.result.damage,4,'HP ▽ permits the decrease to one HP');
  assert.equal(x.defender.hp,1);

  x=run('△');
  assert.equal(x.result.damage,0,'HP △ prohibits the decrease');
  assert.equal(x.defender.hp,5);

  x=run('*');
  assert.equal(x.result.damage,0,'HP * blocks all stat changes');
  assert.equal(x.defender.hp,5);
});

test('unit destruction transfers the unit before ordered equipment and preserves neighboring field slots',()=>{
  const first=unit('field-first',{instanceId:'field-first'});
  const target=unit('equipment-bearing-unit',{instanceId:'equipment-bearing-1',hp:0,maxHp:5,
    equipmentCards:[
      {instanceId:'equip-1',id:'item-1',name:'첫 번째 장비'},
      {instanceId:'equip-2',id:'item-2',name:'두 번째 장비'}
    ]});
  const last=unit('field-last',{instanceId:'field-last'});
  const p=player('player',{units:[first,target,last]});
  const s=state(p,player('ai'));

  FM._test.destroyUnit(s,p,target,{cause:'effect',source:{instanceId:'effect-source',id:'magic-1'}});

  assert.deepEqual(p.units.map(card=>card.instanceId),['field-first','field-last'],
    'removing the destroyed unit must preserve the relative order of survivors');
  assert.deepEqual(p.graveyard.map(card=>card.instanceId),
    ['equipment-bearing-1','equip-1','equip-2'],
    'the destroyed unit enters graveyard before its attached equipment in original order');

  const [event]=s.combatEventQueue.drain();
  assert.equal(event.type,'unit_destroyed');
  assert.equal(event.fieldIndex,1,'event records the original field slot');
  assert.equal(event.sourceInstanceId,'effect-source');
  assert.equal(event.targetInstanceId,'equipment-bearing-1');
  assert.deepEqual(event.snapshot.equipment,[
    {instanceId:'equip-1',cardId:'item-1',name:'첫 번째 장비'},
    {instanceId:'equip-2',cardId:'item-2',name:'두 번째 장비'}
  ]);
  assert.equal(event.payload.equipmentCount,2);
});


test('production Skill2 Devoted Defense resolves when a verified unit is destroyed by a spell effect',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const doomed=sourceSkill2('spell-doomed','헌신방어',{instanceId:'spell-doomed-1',hp:1,maxHp:1,dp:0});
  const next=unit('spell-next',{instanceId:'spell-next-1',hp:4,maxHp:4,ap:3,dp:2});
  const p=s.players.player,ai=s.players.ai;
  ai.units.push(doomed,next);

  FM._test.applyEffect(s,'player',{type:'damage',target:'enemyUnit',amount:1},doomed);

  assert.deepEqual(ai.units.map(card=>card.instanceId),['spell-next-1']);
  assert.equal(FM.totalPower(next,'ap'),4);
  assert.equal(FM.totalPower(next,'dp'),3);
  assert.equal(next.hp,5);
  assert.equal(next.tempHP,1);
  assert.equal(s.combatEventQueue.size(),0,'production event dispatch drains after the spell effect boundary');
});

test('DB29 Manual Skill1 stat effects respect per-stat marker directions',()=>{
  const run=({id,name,skill,ruleId,attackerAP=1,defenderAP=4,defenderDP=2,markers={}}={})=>{
    const attacker=unit(id,{
      instanceId:'marker-skill-attacker',name,skill,ap:attackerAP,dp:0,hp:5,maxHp:5,
      specialSkillRuleId:ruleId,specialSkillMappingStatus:'manual_verified',
      specialSkillRuleAuthority:'manual'
    });
    const defender=unit('marker-skill-defender',{
      instanceId:'marker-skill-defender',ap:defenderAP,dp:defenderDP,hp:10,maxHp:10,
      statTech:{stats:Object.fromEntries(Object.entries(markers).map(([stat,marker])=>[stat,{marker}]))}
    });
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:attackerAP},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:defenderAP},dp:{value:defenderDP},hp:{value:10}}
    });
    return {defender,result};
  };

  // 이블크로우 / 10091525190 / 약화공격
  let x=run({id:'10091525190',name:'이블크로우',skill:'약화공격',ruleId:'weaken_attack',
    defenderAP:4,defenderDP:3,markers:{ap:'▲',dp:'▼'}});
  assert.equal(x.result.damage,0);
  assert.equal(FM.totalPower(x.defender,'ap'),4,'AP ▲ blocks the weakening decrement');
  assert.equal(FM.totalPower(x.defender,'dp'),2,'DP ▼ permits the weakening decrement');

  // 파프니르 / 10010624589 / 석화공격
  x=run({id:'10010624589',name:'파프니르',skill:'석화공격',ruleId:'petrify_attack',
    defenderAP:4,defenderDP:2,markers:{ap:'▲',dp:'▼'}});
  assert.equal(FM.totalPower(x.defender,'ap'),4,'AP ▲ blocks petrification AP reduction');
  assert.equal(FM.totalPower(x.defender,'dp'),2,'DP ▼ blocks petrification DP increase');

  // 해적전투원 / 10010624551 / 방패파괴
  x=run({id:'10010624551',name:'해적전투원',skill:'방패파괴',ruleId:'shield_break',
    defenderAP:4,defenderDP:3,markers:{dp:'▲'}});
  assert.equal(FM.totalPower(x.defender,'dp'),3,'DP ▲ blocks shield-break reduction');

  // 리듬포이 / 10010624563 / 방어전환
  x=run({id:'10010624563',name:'리듬포이',skill:'방어전환공격',ruleId:'defense_convert',
    defenderAP:4,defenderDP:4,markers:{dp:'▲'}});
  assert.equal(FM.totalPower(x.defender,'dp'),4,'DP ▲ blocks defense-conversion reduction');
});

test('DB29 Manual Fatal Attack does not revive an already-zero-HP defender',()=>{
  // Manual specialability.htm #3: HP 0 means the unit is destroyed.
  // DB29 exact Skill1 representative: 선더골렘 / 10012024612 / 치명공격.
  const attacker=unit('10012024612',{
    instanceId:'fatal-manual-attacker',name:'선더골렘',skill:'치명공격',
    ap:3,dp:0,hp:5,maxHp:5,
    specialSkillRuleId:'fatal_attack',
    specialSkillMappingStatus:'manual_verified',
    specialSkillRuleAuthority:'manual'
  });
  const defender=unit('fatal-zero-target',{
    instanceId:'fatal-zero-target',ap:1,dp:0,hp:0,maxHp:5
  });
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]});
  const s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:3},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:1},dp:{value:0},hp:{value:0}}
  });
  assert.equal(result.damage,0,'an already-zero-HP target receives no fabricated damage');
  assert.equal(result.defenderAlive,false,'zero-HP target must not be revived by fatal attack');
  assert.equal(ai.units.includes(defender),false,'destroyed target leaves the field');
  assert.equal(ai.graveyard.includes(defender),true,'destroyed target remains in the graveyard');
  assert.equal(defender.hp,0,'fatal attack must not restore HP to a destroyed target');
});


// DB29 representative Skill1 cards selected from the Manual 27-rule test spec.
// The card IDs below have exact Skill1-label matches in DB29. Their card-local
// TextBase/TextExtra semantic packets remain a separate review gate; these tests
// exercise the Manual baseline through the exact source-card mapping tuple.
function db29ManualSkill1(id,name,skill,ruleId,extra={}){
  return unit(id,{
    instanceId:'db29-manual-skill1-'+ruleId,
    name,skill,
    specialSkillRuleId:ruleId,
    specialSkillMappingStatus:'manual_verified',
    specialSkillRuleAuthority:'manual',
    ...extra
  });
}

test('DB29 source card 카오틱비스트 uses Manual defense-bypass against positive and negative DP',()=>{
  // 10091525193 / 카오틱비스트 / Skill1=방어무시.
  const run=(defenderDP)=>{
    const attacker=db29ManualSkill1('10091525193','카오틱비스트','방어무시','defense_bypass',{ap:3,dp:0,hp:5,maxHp:5});
    const defender=unit('defense-bypass-target',{instanceId:'defense-bypass-target-'+defenderDP,dp:defenderDP,hp:8,maxHp:8});
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:3},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:1},dp:{value:defenderDP},hp:{value:8}}
    });
    return {defender,result};
  };
  let x=run(5);
  assert.equal(x.result.damage,3,'defense bypass deals AP directly to HP');
  assert.equal(x.defender.hp,5);
  assert.equal(x.defender.dp,5,'positive DP is not consumed');
  x=run(-3);
  assert.equal(x.result.damage,3,'negative DP is ignored rather than added to damage');
  assert.equal(x.defender.hp,5);
  assert.equal(x.defender.dp,-3);
});

test('DB29 source card 다크퍼밀리어 uses Manual frenzy attack and leaves the attacker at one HP',()=>{
  // 10010624538 / 다크퍼밀리어 / Skill1=광분공격.
  const attacker=db29ManualSkill1('10010624538','다크퍼밀리어','광분공격','frenzy_attack',{ap:0,dp:0,hp:4,maxHp:4});
  const defender=unit('frenzy-target',{instanceId:'frenzy-target',dp:0,hp:10,maxHp:10});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:0},dp:{value:0},hp:{value:4}},
    defender:{ap:{value:1},dp:{value:0},hp:{value:10}}
  });
  assert.equal(attacker.hp,1,'frenzy sacrifices HP but never below one');
  assert.equal(result.damage,3,'the three sacrificed HP are added to the attack');
  assert.equal(defender.hp,7);

  // Manual specialability.htm §13 adds lost HP to AP before defender DP is applied.
  const reduced=db29ManualSkill1('10010624538','다크퍼밀리어','광분공격','frenzy_attack',{ap:0,dp:0,hp:4,maxHp:4});
  const reducedTarget=unit('frenzy-dp-target',{instanceId:'frenzy-dp-target',dp:2,hp:10,maxHp:10});
  const rp=player('player',{units:[reduced]}),rai=player('ai',{units:[reducedTarget]});
  const rr=FM._test.resolveUnitAttack(state(rp,rai),rp,rai,reduced,reducedTarget,{
    attacker:{ap:{value:0},dp:{value:0},hp:{value:4}},
    defender:{ap:{value:1},dp:{value:2},hp:{value:10}}
  });
  assert.equal(reduced.hp,1,'frenzy still sacrifices to one HP at zero AP');
  assert.equal(rr.damage,1,'the three sacrificed HP are reduced by defender DP 2');
  assert.equal(reducedTarget.hp,9);

  const boundary=db29ManualSkill1('10010624538','다크퍼밀리어','광분공격','frenzy_attack',{ap:1,dp:0,hp:1,maxHp:4});
  const target=unit('frenzy-one-hp-target',{instanceId:'frenzy-one-hp-target',dp:0,hp:5,maxHp:5});
  const bp=player('player',{units:[boundary]}),bai=player('ai',{units:[target]});
  const br=FM._test.resolveUnitAttack(state(bp,bai),bp,bai,boundary,target,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:1}},
    defender:{ap:{value:1},dp:{value:0},hp:{value:5}}
  });
  assert.equal(boundary.hp,1,'frenzy has no HP to sacrifice at the one-HP floor');
  assert.equal(br.damage,1);
  assert.equal(target.hp,4);
});

test('DB29 source card 환상낚시꾼 uses Manual ability-seal mapping to suppress a target special skill',()=>{
  // 10020324644 / 환상낚시꾼 / Skill1=기술봉쇄.
  const attacker=db29ManualSkill1('10020324644','환상낚시꾼','기술봉쇄','ability_seal',{ap:1,dp:0,hp:5,maxHp:5});
  const defender=unit('ability-seal-source-target',{
    instanceId:'ability-seal-source-target',skill:'방어무시기술',ap:3,dp:0,hp:10,maxHp:10
  });
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:3},dp:{value:0},hp:{value:10}}
  });
  assert.equal(defender.skill,'일반공격기술');
  assert.equal(FM._test.normalizeSpecialSkillForEngine(defender,defender.skill),'일반공격');
});

test('DB29 source card 진실의거울 copies the defender effective AP for its attack',()=>{
  // 10050441147 / 진실의거울 / Skill1=공격복제.
  const attacker=db29ManualSkill1('10050441147','진실의거울','공격복제','copy_attack',{ap:1,dp:0,hp:5,maxHp:5});
  const defender=unit('copy-attack-target',{instanceId:'copy-attack-target',ap:4,dp:1,hp:10,maxHp:10});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:4},dp:{value:1},hp:{value:10}}
  });
  assert.equal(result.damage,3,'copied defender AP 4 minus defender DP 1');
  assert.equal(defender.hp,7);
});

test('DB29 source card 포춘텔러 uses Manual defensive-use damage with signed defender DP',()=>{
  // 10010624568 / 포춘텔러 / Skill1=방어이용.
  const run=(defenderDP)=>{
    const attacker=db29ManualSkill1('10010624568','포춘텔러','방어이용','defensive_use',{ap:2,dp:0,hp:5,maxHp:5});
    const defender=unit('defensive-use-target',{instanceId:'defensive-use-target-'+defenderDP,dp:defenderDP,hp:10,maxHp:10});
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:2},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:1},dp:{value:defenderDP},hp:{value:10}}
    });
    return {defender,result};
  };
  let x=run(3);
  assert.equal(x.result.damage,5,'AP 2 plus positive DP 3');
  assert.equal(x.defender.hp,5);
  x=run(-3);
  assert.equal(x.result.damage,0,'negative DP reduces the attack and damage is clamped at zero');
  assert.equal(x.defender.hp,10);
});

test('DB29 source card 다크조커 uses Manual taunt attack to leave the defender at one HP and gain its lost HP as AP',()=>{
  // 10030324709 / 다크조커 / Skill1=조롱공격.
  const attacker=db29ManualSkill1('10030324709','다크조커','조롱공격','taunt_attack',{ap:1,dp:0,hp:5,maxHp:5});
  const defender=unit('taunt-target',{instanceId:'taunt-target',ap:2,dp:0,hp:8,maxHp:8});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:2},dp:{value:0},hp:{value:8}}
  });
  assert.equal(result.damage,1,'ordinary attack damage resolves before the taunt conversion');
  assert.equal(defender.hp,1);
  assert.equal(FM.totalPower(defender,'ap'),8,'six remaining HP are transferred to the original AP 2');
});

test('DB29 source card 견습수도사 uses Manual confusion attack to exchange target AP and remaining HP',()=>{
  // 10040724804 / 견습수도사 / Skill1=혼란공격.
  const attacker=db29ManualSkill1('10040724804','견습수도사','혼란공격','confusion_attack',{ap:1,dp:0,hp:5,maxHp:5});
  const defender=unit('confusion-target',{instanceId:'confusion-target',ap:3,dp:0,hp:5,maxHp:5});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:3},dp:{value:0},hp:{value:5}}
  });
  assert.equal(FM.totalPower(defender,'ap'),5,'the Manual rule exchanges the target AP with its HP at the hit-resolution point');
  assert.equal(defender.hp,2,'the one-point attack damage is applied after the AP/HP exchange');

  // Manual cardability.htm §6: AP ▲ blocks a decrease, so an AP 5→3
  // swap is refused and the paired HP change is not attempted.
  const guarded=db29ManualSkill1('10040724804','견습수도사','혼란공격','confusion_attack',{
    ap:1,dp:0,hp:5,maxHp:5
  });
  const guardedTarget=unit('confusion-ap-marker-target',{
    instanceId:'confusion-ap-marker-target',ap:5,dp:0,hp:3,maxHp:5,statMarkers:{ap:'▲'}
  });
  const gp=player('player',{units:[guarded]}),gai=player('ai',{units:[guardedTarget]});
  FM._test.resolveUnitAttack(state(gp,gai),gp,gai,guarded,guardedTarget,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:5},dp:{value:0},hp:{value:3}}
  });
  assert.equal(FM.totalPower(guardedTarget,'ap'),5,'AP increase-only marker blocks the decrease required by the swap');
  assert.equal(guardedTarget.hp,2,'blocked AP exchange leaves HP unchanged before the one-point attack damage');
});

test('DB29 source card 블라인드랩터 gains one DP from Manual stealth attack even when DP blocks all HP damage',()=>{
  // 10040724812 / 블라인드랩터 / Skill1=은폐공격.
  const attacker=db29ManualSkill1('10040724812','블라인드랩터','은폐공격','stealth_attack',{ap:1,dp:2,hp:5,maxHp:5});
  const defender=unit('stealth-target',{instanceId:'stealth-target',dp:5,hp:10,maxHp:10});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:2},hp:{value:5}},
    defender:{ap:{value:1},dp:{value:5},hp:{value:10}}
  });
  assert.equal(result.damage,0,'the defender DP blocks all HP damage');
  assert.equal(defender.hp,10);
  assert.equal(FM.totalPower(attacker,'dp'),3,'stealth adds one DP after the attack');
});


// Follow-up Manual Skill1 positive/negative/boundary cases. These keep the
// exact DB29 representative card tuple and test the missing edge, not a new
// inferred rule or a card-specific semantic promotion.
test('DB29 은룡의검 ordinary attack has zero-damage and zero-AP boundaries',()=>{
  const run=(attackAP,defenderDP)=>{
    const attacker=db29ManualSkill1('10020341112','은룡의검','일반공격','normal_attack',{ap:attackAP,dp:0,hp:5,maxHp:5});
    const defender=unit('normal-boundary-target',{instanceId:'normal-boundary-target-'+attackAP+'-'+defenderDP,dp:defenderDP,hp:8,maxHp:8});
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:attackAP},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:1},dp:{value:defenderDP},hp:{value:8}}
    });
    return {defender,result};
  };
  let x=run(1,1);
  assert.equal(x.result.damage,0,'AP equal to DP produces no HP damage');
  assert.equal(x.defender.hp,8);
  assert.equal(x.defender.dp,1,'ordinary attack never consumes DP');
  x=run(0,0);
  assert.equal(x.result.damage,0,'zero rolled AP does not create a normal attack');
  assert.equal(x.defender.hp,8);
});

test('DB29 타락자 aging attack applies the full AP-2 below zero',()=>{
  const attacker=db29ManualSkill1('13020626691','타락자','노화공격','aging_attack',{ap:1,dp:0,hp:5,maxHp:5});
  const defender=unit('aging-floor-target',{instanceId:'aging-floor-target',ap:1,dp:0,hp:10,maxHp:10});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:1},dp:{value:0},hp:{value:10}}
  });
  assert.equal(FM.totalPower(defender,'ap'),-1,'Manual AP-2 has no documented zero floor');
  assert.equal(result.damage,1);
  assert.equal(defender.hp,9);
});

test('DB29 울프라이더 regeneration always adds one HP at printed maximum HP',()=>{
  const attacker=db29ManualSkill1('10010624560','울프라이더','재생능력','regeneration',{ap:1,dp:0,hp:5,maxHp:5});
  const defender=unit('regeneration-cap-target',{instanceId:'regeneration-cap-target',dp:5,hp:10,maxHp:10});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:1},dp:{value:5},hp:{value:10}}
  });
  assert.equal(result.damage,0,'defender DP blocks the attack');
  assert.equal(attacker.hp,6,'Manual says HP +1 unconditionally, including at printed maximum HP');
  assert.equal(defender.hp,10);
});

test('DB29 다크조커 taunt does not transfer AP when the defender is already at the one-HP floor',()=>{
  const attacker=db29ManualSkill1('10030324709','다크조커','조롱공격','taunt_attack',{ap:1,dp:0,hp:5,maxHp:5});
  const defender=unit('taunt-floor-target',{instanceId:'taunt-floor-target',ap:2,dp:0,hp:1,maxHp:8});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:2},dp:{value:0},hp:{value:1}}
  });
  assert.equal(result.damage,1);
  assert.equal(result.defenderAlive,false,'the one-HP defender is destroyed by the ordinary attack');
  assert.equal(FM.totalPower(defender,'ap'),2,'no HP remains to transfer into AP');
});

test('DB29 블라인드랩터 stealth DP gain respects an HP-independent DP-increase prohibition marker',()=>{
  const attacker=db29ManualSkill1('10040724812','블라인드랩터','은폐공격','stealth_attack',{
    ap:1,dp:2,hp:5,maxHp:5,statMarkers:{dp:'▼'}
  });
  const defender=unit('stealth-marker-target',{instanceId:'stealth-marker-target',dp:5,hp:10,maxHp:10});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:2},hp:{value:5}},
    defender:{ap:{value:1},dp:{value:5},hp:{value:10}}
  });
  assert.equal(result.damage,0);
  assert.equal(FM.totalPower(attacker,'dp'),2,'the DP-increase marker blocks the stealth bonus');
});

test('DB29 리듬포이 defense conversion leaves zero and negative DP unchanged',()=>{
  const run=(defenderDP)=>{
    const attacker=db29ManualSkill1('10010624563','리듬포이','방어변환','defense_convert',{ap:1,dp:0,hp:5,maxHp:5});
    const defender=unit('defense-convert-boundary-target',{instanceId:'defense-convert-boundary-'+defenderDP,dp:defenderDP,hp:10,maxHp:10});
    const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
    const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
      attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
      defender:{ap:{value:1},dp:{value:defenderDP},hp:{value:10}}
    });
    return {defender,result};
  };
  let x=run(0);
  assert.equal(FM.totalPower(x.defender,'dp'),0,'zero DP is not converted');
  x=run(-2);
  assert.equal(FM.totalPower(x.defender,'dp'),-2,'negative DP is not inverted a second time');
  assert.equal(x.result.damage,3,'signed negative DP still contributes to ordinary attack damage');
});


test('DB29 진실의거울 copy attack produces no damage when the copied target AP is zero',()=>{
  const attacker=db29ManualSkill1('10050441147','진실의거울','공격복제','copy_attack',{ap:4,dp:0,hp:5,maxHp:5});
  const defender=unit('copy-zero-ap-target',{instanceId:'copy-zero-ap-target',ap:0,dp:2,hp:10,maxHp:10});
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:4},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:0},dp:{value:2},hp:{value:10}}
  });
  assert.equal(result.damage,0,'copy attack uses the target AP, not the attacker AP');
  assert.equal(defender.hp,10);
});

test('DB29 환상낚시꾼 ability seal changes Skill1 only and preserves the separate Skill2 tuple',()=>{
  const attacker=db29ManualSkill1('10020324644','환상낚시꾼','기술봉쇄','ability_seal',{ap:1,dp:0,hp:5,maxHp:5});
  const defender=unit('ability-seal-skill2-target',{
    instanceId:'ability-seal-skill2-target',
    skill:'방어무시기술',
    specialSkill2:'헌신방어',
    specialSkill2RuleId:'devoted_defense',
    specialSkill2MappingStatus:'source_card_verified',
    specialSkill2RuleAuthority:'card_source',
    specialSkill2ExecutionStatus:'source-card-rule-implemented',
    ap:2,dp:0,hp:10,maxHp:10
  });
  const p=player('player',{units:[attacker]}),ai=player('ai',{units:[defender]}),s=state(p,ai);
  FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:2},dp:{value:0},hp:{value:10}}
  });
  assert.equal(defender.skill,'일반공격기술','Skill1 ability seal only converts the Skill1 field');
  assert.equal(defender.specialSkill2,'헌신방어');
  assert.equal(defender.specialSkill2RuleId,'devoted_defense');
  assert.equal(defender.specialSkill2MappingStatus,'source_card_verified');
});

test('production Racial Defense counts only other matching friendly field units and ignores missing or enemy races',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'racial-boundary-atk'});
  const defender=sourceSkill2('defender','레이셜디펜스',{
    instanceId:'racial-boundary-def',hp:8,maxHp:8,dp:0,race:'elf'
  });
  const matching=unit('matching',{instanceId:'racial-boundary-match',race:'elf'});
  const mismatched=unit('mismatched',{instanceId:'racial-boundary-mismatch',race:'orc'});
  const missing=unit('missing',{instanceId:'racial-boundary-missing'});
  const enemyMatching=unit('enemy-matching',{instanceId:'racial-enemy-match',race:'elf'});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(defender,matching,mismatched,missing);
  ai.units.push(attacker,enemyMatching);
  const result=FM._test.resolveUnitAttack(s,ai,p,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(1,0,8)
  });
  assert.equal(result.damage,3,'only one other friendly unit with the exact race reduces raw damage 4');
  assert.equal(defender.hp,5);
  assert.equal(enemyMatching.hp,5,'enemy-side race does not contribute to defending-side count');
});

test('production Racial Defense gives no reduction when the defender has no race',()=>{
  const s=FM.newGame({cards:[],playerDeck:[],aiDeck:[],rng:()=>0.25});
  const attacker=unit('attacker',{instanceId:'racial-empty-atk'});
  const defender=sourceSkill2('defender','레이셜디펜스',{
    instanceId:'racial-empty-def',hp:8,maxHp:8,dp:0,race:''
  });
  const ally=unit('ally',{instanceId:'racial-empty-ally',race:'elf'});
  const p=s.players.player,ai=s.players.ai;
  p.units.push(defender,ally); ai.units.push(attacker);
  const result=FM._test.resolveUnitAttack(s,ai,p,attacker,defender,{
    attacker:combatStats(4,0,5),defender:combatStats(1,0,8)
  });
  assert.equal(result.damage,4);
  assert.equal(defender.hp,4);
});



test('new units start with an empty data-only status record collection',()=>{
  const template=unit('status-template',{statusRecords:[{statusName:'데스',durationTurns:2}]});
  const created=FM._test.createUnit(template);
  assert.deepEqual(created.statusRecords,[]);
  assert.equal(created.canAttack,true);
});

test('unit status records preserve exact duration and source without merging or applying effects',()=>{
  const target=unit('status-target',{instanceId:'status-target-1',hp:5,maxHp:5,canAttack:true});
  const first=FM._test.addUnitStatusRecord(target,'데스',2,{
    sourceInstanceId:'death-memory-source',sourceCardId:'11112425427',sourceRuleId:'skill1_death_memory'
  });
  const second=FM._test.addUnitStatusRecord(target,'데스',1,{
    sourceInstanceId:'other-status-source',sourceCardId:'spell-death-source'
  });
  assert.equal(first.ok,true);
  assert.equal(second.ok,true);
  assert.equal(target.statusRecords.length,2,'reapplications remain separate until stacking rules are verified');
  assert.deepEqual(target.statusRecords.map(record=>record.durationTurns),[2,1]);
  assert.equal(target.statusRecords[0].durationTickPolicy,'unresolved');
  assert.equal(target.statusRecords[0].sourceCardId,'11112425427');
  assert.equal(target.statusRecords[0].sourceRuleId,'skill1_death_memory');
  assert.equal(target.hp,5,'record storage does not damage or kill the unit');
  assert.equal(target.canAttack,true,'record storage does not impose an action lock');
});

test('status record validation and explicit removal do not infer duration semantics',()=>{
  const target=unit('status-remove-target');
  assert.equal(FM._test.addUnitStatusRecord(target,'',2).reason,'status_name_required');
  assert.equal(FM._test.addUnitStatusRecord(target,'데스',0).reason,'invalid_duration');
  assert.equal(FM._test.addUnitStatusRecord(target,'데스',2.5).reason,'invalid_duration');
  FM._test.addUnitStatusRecord(target,'데스',2);
  FM._test.addUnitStatusRecord(target,'빙결',3);
  FM._test.addUnitStatusRecord(target,'데스',1);
  assert.deepEqual(FM._test.removeUnitStatusRecords(target,'데스'),{ok:true,removedCount:2});
  assert.deepEqual(target.statusRecords.map(record=>record.statusName),['빙결']);
  assert.deepEqual(FM._test.clearUnitStatusRecords(target),{ok:true,removedCount:1});
  assert.deepEqual(target.statusRecords,[]);
});

test('combat unit snapshots preserve isolated status record evidence',()=>{
  const target=unit('status-snapshot-target',{instanceId:'status-snapshot-1'});
  FM._test.addUnitStatusRecord(target,'데스',2,{sourceCardId:'11112425427'});
  const snapshot=FM._test.snapshotCombatUnit(target);
  const event=FM._test.createCombatEvent('unit_destroyed',{snapshot:{unit:snapshot}});
  target.statusRecords[0].durationTurns=99;
  assert.equal(event.snapshot.unit.statusRecords[0].durationTurns,2);
  assert.equal(event.snapshot.unit.statusRecords[0].sourceCardId,'11112425427');
  assert.equal(Object.isFrozen(event.snapshot.unit.statusRecords),true);
});

test('AI uses the same runtime cost profile as actual card payment',()=>{
  const candidate=unit('runtime-cost-ai',{
    instanceId:'runtime-cost-ai-1',
    cost:{dark:1},costKnown:true,costMapped:true,
    runtimeCost:{forest:1},runtimeCostKnown:true,runtimeCostStatus:'implemented_inferred'
  });
  const p=player('player');
  const ai=player('ai',{hand:[candidate],soulPool:{colored:{forest:1},neutral:0},
    unitDeployLimit:1,unitDeployedThisPhase:0});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal'}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.units.length,1,'AI should deploy a card affordable through runtimeCost');
  assert.equal(ai.units[0].id,'runtime-cost-ai');
  assert.equal(ai.hand.length,0);
  assert.equal(ai.soulPool.colored.forest,0);
  assert.equal(ai.soulPool.colored.dark||0,0);
  assert.equal(s.prepared.ai,true);
});

test('deck editor starts a fresh profile empty and preserves zero/partial edits; starter is explicit',()=>{
  let created=0;
  const starter=()=>{created++;return {starterCard:50};};
  const fresh={deckCounts:null};
  assert.deepEqual(DeckState.currentDeckCounts(fresh,50,()=>({})),{});
  assert.deepEqual(fresh.deckCounts,{},'fresh profile must not silently prefill 50 cards');
  const partial={deckCounts:{cardA:3}};
  assert.deepEqual(DeckState.currentDeckCounts(partial,50,starter),{cardA:3});
  assert.equal(created,0,'partial user edits must not be reset to a starter deck');
  const empty={deckCounts:{}};
  assert.deepEqual(DeckState.currentDeckCounts(empty,50,starter),{});
  assert.equal(created,0,'an intentionally cleared deck must remain empty');
  assert.deepEqual(DeckState.currentDeckCounts(fresh,0,starter),{});
  assert.equal(created,0,'no available cards must not initialize a deck');
  assert.deepEqual(starter(),{starterCard:50},'starter deck generation is available only when explicitly requested');
  assert.equal(created,1);
});

test('deck editor clear action resets state to an empty object and is wired to persist it',()=>{
  const fs=require('node:fs');
  const appSource=fs.readFileSync(require.resolve('../app/src/main/assets/game/app.js'),'utf8');
  const htmlSource=fs.readFileSync(require.resolve('../app/src/main/assets/game/index.html'),'utf8');
  const htmlScript=fs.readFileSync(require.resolve('../app/src/main/assets/game/index.html'),'utf8');
  assert.match(htmlSource,/id="clear-deck"/);
  assert.match(htmlScript,/<script src="deck-state\.js"><\/script>\s*<script src="app\.js"><\/script>/);
  assert.match(appSource,/el\('clear-deck'\)\.addEventListener\('click', \(\) => \{ FM\.DeckState\.clearDeckCounts\(data\); safeWrite\(\); renderDeck\(\); \}\)/);
  const data={deckCounts:{cardA:50}};
  assert.deepEqual(DeckState.clearDeckCounts(data),{});
  assert.deepEqual(JSON.parse(JSON.stringify(data.deckCounts)),{},'empty deck state must survive serialization');
});

test('AI skips an unaffordable land and installs the next payable land',()=>{
  const blockedLand={...land('ai-expensive-land','metal'),instanceId:'ai-land-expensive',
    landInstallCost:{metal:1}};
  const payableLand={...land('ai-payable-land','forest'),instanceId:'ai-land-payable',
    landInstallCost:{forest:1}};
  const p=player('player');
  const ai=player('ai',{hand:[blockedLand,payableLand],
    lp:2,soulPool:{colored:{forest:1},neutral:0}});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal'}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.lands.length,1);
  assert.equal(ai.lands[0].id,'ai-payable-land');
  assert.equal(ai.hand.length,1);
  assert.equal(ai.hand[0].id,'ai-expensive-land');
});

test('starter deck prioritizes affordable terrain and runtime-cost cards over source order',()=>{
  const expensiveLands=Array.from({length:10},(_,i)=>land('exp-land-'+i,'forest',4,0)).map(c=>({...c,deckLimit:4,landInstallCost:{forest:3}}));
  const unknownLands=Array.from({length:10},(_,i)=>land('unknown-land-'+i,'forest',1,0)).map(c=>({...c,deckLimit:4,landInstallCostKnown:false,landInstallCost:undefined}));
  const affordableLands=Array.from({length:10},(_,i)=>land('cheap-land-'+i,'forest',1,0)).map(c=>({...c,deckLimit:4,landInstallCost:{neutral:0}}));
  const costlyUnits=Array.from({length:24},(_,i)=>unit('costly-unit-'+i,{deckLimit:4,cost:{forest:3},runtimeCost:{forest:3},runtimeCostKnown:true}));
  const affordableUnits=Array.from({length:24},(_,i)=>unit('cheap-unit-'+i,{deckLimit:4,cost:{forest:2},runtimeCost:{forest:1},runtimeCostKnown:true}));
  const otherCards=Array.from({length:8},(_,i)=>({id:'other-'+i,name:'other-'+i,type:'spell',faction:'forest',deckLimit:4,cost:{forest:2},runtimeCost:{forest:1},runtimeCostKnown:true,effect:{type:'draw',amount:1}}));
  const deck=FM.buildStarterDeck(unknownLands.concat(expensiveLands,affordableLands,costlyUnits,affordableUnits,otherCards),'forest');
  assert.equal(deck.length,50);
  assert.ok(deck.slice(0,10).every(c=>c.id.startsWith('cheap-land-')));
  assert.ok(deck.slice(10,34).every(c=>c.id.startsWith('cheap-unit-')));
  assert.ok(deck.slice(34).every(c=>c.id.startsWith('other-')));
});

test('AI uses paid terminal fallback enchants rather than leaving them stranded in hand',()=>{
  const enchant={id:'ai-enchant-fallback',name:'AI fallback enchant',type:'enchant',
    instanceId:'ai-enchant-fallback-1',faction:'forest',cost:{forest:1},costKnown:true,costMapped:true,
    runtimeCost:{forest:1},runtimeCostKnown:true,runtimeCostStatus:'source_verified',
    runtimeEffectDisposition:'fallback_noop',slotIndex:1,slotOwner:'own'};
  const p=player('player');
  const ai=player('ai',{hand:[enchant],soulPool:{colored:{forest:1},neutral:0},unitDeployLimit:0});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal'}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.hand.length,0);
  assert.equal(ai.graveyard.length,1);
  assert.equal(ai.graveyard[0].id,'ai-enchant-fallback');
  assert.equal(ai.soulPool.colored.forest,0);
  assert.equal(ai.playedAnyCardThisPhase,true);
  assert.equal(s.prepared.ai,true);
});

test('AI skips an item with no legal target and plays the next compatible item',()=>{
  const unitOnField=unit('ai-item-target',{instanceId:'ai-item-target-1',race:'human',affiliation:'guild'});
  const impossible={id:'ai-item-impossible',name:'Unusable race item',type:'item',
    instanceId:'ai-item-impossible-1',faction:'forest',cost:{forest:1},costKnown:true,costMapped:true,
    runtimeCost:{forest:1},runtimeCostKnown:true,runtimeItemConditionStatus:'source_verified',
    itemConditions:{race:'elf'},allowedUnitAbilities:['장비'],apBonus:5,dpBonus:0,hpBonus:0};
  const payable={...impossible,id:'ai-item-payable',name:'Compatible item',instanceId:'ai-item-payable-1',
    itemConditions:{race:'human'},apBonus:1};
  const p=player('player');
  const ai=player('ai',{hand:[impossible,payable],units:[unitOnField],
    soulPool:{colored:{forest:2},neutral:0},unitDeployLimit:0});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal'}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.hand.length,1);
  assert.equal(ai.hand[0].id,'ai-item-impossible');
  assert.equal(unitOnField.equipmentCards.length,1);
  assert.equal(unitOnField.equipmentCards[0].id,'ai-item-payable');
  assert.equal(ai.soulPool.colored.forest,1);
});

test('AI prefers the lower soul-cost land when LP requirements are equal',()=>{
  const highCost={...land('ai-land-high-cost','forest',1,0),instanceId:'ai-land-high-cost-1',
    landInstallCost:{forest:2}};
  const lowCost={...land('ai-land-low-cost','forest',1,0),instanceId:'ai-land-low-cost-1',
    landInstallCost:{forest:1}};
  const p=player('player');
  const ai=player('ai',{hand:[highCost,lowCost],lp:2,soulPool:{colored:{forest:2},neutral:0}});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal'}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.lands.length,1);
  assert.equal(ai.lands[0].id,'ai-land-low-cost');
  assert.equal(ai.soulPool.colored.forest,2,'land production offsets the one-soul installation payment');
  assert.equal(ai.hand[0].id,'ai-land-high-cost');
});

test('AI pays and uses a no-op fallback spell even when its source target is unavailable',()=>{
  const spell={id:'ai-fallback-spell',name:'AI fallback spell',type:'spell',
    instanceId:'ai-fallback-spell-1',faction:'forest',cost:{forest:1},costKnown:true,costMapped:true,
    runtimeCost:{forest:1},runtimeCostKnown:true,runtimeCostStatus:'source_verified',
    runtimeEffectDisposition:'fallback_noop',effect:{type:'damage',target:'enemyUnit',amount:4}};
  const p=player('player');
  const ai=player('ai',{hand:[spell],soulPool:{colored:{forest:1},neutral:0},unitDeployLimit:0});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal'}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.hand.length,0);
  assert.equal(ai.graveyard.length,1);
  assert.equal(ai.graveyard[0].id,'ai-fallback-spell');
  assert.equal(ai.soulPool.colored.forest,0);
  assert.equal(ai.playedAnyCardThisPhase,true);
  assert.equal(s.prepared.ai,true);
});

test('initial hand prefers an installable zero-soul land over an unusable paid land',()=>{
  const deck=Array.from({length:50},(_,i)=>unit('initial-unit-'+i));
  deck[1]={...land('paid-first-land','forest',1,0),deckLimit:4,instanceId:'paid-first-land-1',
    landInstallCost:{forest:1}};
  deck[7]={...land('free-playable-land','forest',1,0),deckLimit:4,instanceId:'free-playable-land-1',
    landInstallCost:{neutral:0}};
  const game=FM.newGame({cards:deck,playerDeck:deck,aiDeck:deck,rng:()=>0});
  assert.ok(game.players.player.hand.some(card=>card.id==='free-playable-land'));
  assert.ok(game.players.ai.hand.some(card=>card.id==='free-playable-land'));
});

test('AI plays a supported spell into its spell row when it can pay',()=>{
  const spell={id:'ai-supported-spell',name:'AI supported spell',type:'spell',
    instanceId:'ai-supported-spell-1',faction:'forest',cost:{forest:1},costKnown:true,costMapped:true,
    runtimeCost:{forest:1},runtimeCostKnown:true,runtimeCostStatus:'source_verified',
    runtimeEffectDisposition:'source_verified',effect:{type:'draw',amount:1},triggerTiming:'turn_start',
    duration:1};
  const p=player('player');
  const ai=player('ai',{hand:[spell],soulPool:{colored:{forest:1},neutral:0},unitDeployLimit:0});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal'}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.hand.length,0);
  assert.equal(ai.spells.length,1);
  assert.equal(ai.spells[0].id,'ai-supported-spell');
  assert.equal(ai.soulPool.colored.forest,0);
  assert.equal(ai.playedAnyCardThisPhase,true);
  assert.equal(s.prepared.ai,true);
});

test('player land and unit payments lead into an AI resource-play phase and battle progression',()=>{
  const pLand={...land('turn-player-land','forest',1,0),instanceId:'turn-player-land-1'};
  const pUnit=unit('turn-player-unit',{instanceId:'turn-player-unit-1'});
  const aLand={...land('turn-ai-land','forest',1,0),instanceId:'turn-ai-land-1'};
  const aUnit=unit('turn-ai-unit',{instanceId:'turn-ai-unit-1'});
  const p=player('player',{hand:[pLand,pUnit],lp:1,soulPool:{colored:{},neutral:0},unitDeployLimit:0});
  const ai=player('ai',{hand:[aLand,aUnit],lp:0,soulPool:{colored:{},neutral:0},unitDeployLimit:0});
  const s=state(p,ai,{settings:{difficulty:'normal'}});
  assert.equal(FM.playCard(s,'player',pLand.instanceId).ok,true);
  assert.equal(FM.playCard(s,'player',pUnit.instanceId).ok,true);
  assert.equal(p.lands.length,1);
  assert.equal(p.units.length,1);
  assert.equal(p.soulPool.colored.forest,0);
  assert.equal(FM.endPhase(s,'player').ok,true);
  assert.ok(ai.lands.length>=1,'AI should install its free first land during its prep phase');
  assert.ok(ai.units.length>=1 || ai.graveyard.some(card=>card.id==='turn-ai-unit'),
    'AI should deploy its affordable unit before battle resolution');
  assert.ok(s.round>=2,'the preparation phases should resolve into the next battle round');
  assert.equal(s.status,'playing');
});


test('unverified Skill1 candidate cannot dispatch a manual combat handler but retains ordinary attack',()=>{
  const attacker=unit('candidate-skill1',{
    instanceId:'candidate-skill1-instance',
    name:'검증 대기 유닛',
    skill:'조롱공격',
    ap:1,dp:0,hp:5,maxHp:5,
    specialSkillRuleId:'taunt_attack',
    specialSkillMappingStatus:'candidate',
    specialSkillRuleAuthority:'community'
  });
  const defender=unit('candidate-skill1-target',{
    instanceId:'candidate-skill1-target-instance',
    name:'상대 유닛',
    ap:4,dp:0,hp:10,maxHp:10
  });
  const p=player('player',{units:[attacker]});
  const ai=player('ai',{units:[defender]});
  const s=state(p,ai);
  const result=FM._test.resolveUnitAttack(s,p,ai,attacker,defender,{
    attacker:{ap:{value:1},dp:{value:0},hp:{value:5}},
    defender:{ap:{value:4},dp:{value:0},hp:{value:10}}
  });
  assert.equal(result.damage,1,'candidate mapping must not alter ordinary attack damage');
  assert.equal(defender.hp,9,'the card remains playable and performs its base attack');
  assert.equal(FM.totalPower(defender,'ap'),4,'unverified taunt rule must not be dispatched');
});


test('DB29 Skill1 normalization enforces mapping status, authority and known rule ID as a complete tuple',()=>{
  const normalize=FM._test.normalizeSpecialSkillForEngine;
  const valid={specialSkillMappingStatus:'manual_verified',specialSkillRuleAuthority:'manual',
    specialSkillRuleId:'taunt_attack'};
  assert.equal(normalize(valid,'untrusted raw text'),'조롱');
  const invalidTuples=[
    {specialSkillMappingStatus:'community_candidate',specialSkillRuleAuthority:'manual',specialSkillRuleId:'taunt_attack'},
    {specialSkillMappingStatus:'manual_verified',specialSkillRuleAuthority:'community',specialSkillRuleId:'taunt_attack'},
    {specialSkillMappingStatus:'source_card_verified',specialSkillRuleAuthority:'manual',specialSkillRuleId:'taunt_attack'},
    {specialSkillMappingStatus:'manual_verified',specialSkillRuleAuthority:'manual',specialSkillRuleId:'not_a_real_rule'},
    {specialSkillMappingStatus:'manual_verified',specialSkillRuleAuthority:'card_source',specialSkillRuleId:'taunt_attack'}
  ];
  for(const mapping of invalidTuples){
    assert.equal(normalize(mapping,'조롱공격'),'',
      'a compact DB29 mapping with an incomplete or unauthorized tuple must fail closed');
  }
  assert.equal(normalize({...valid,specialSkillRuleId:'defense_bypass'},'조롱공격'),'방어무시',
    'runtime execution follows the verified rule ID, not an unrelated printed/raw label');
});


test('deck quantity decrement from one to zero persists an empty edit and rejects underflow',()=>{
  const data={deckCounts:{singleCard:1}};
  const result=DeckState.adjustDeckCounts(data,'singleCard',-1,4,50);
  assert.equal(result.ok,true);
  assert.equal(result.next,0);
  assert.deepEqual(data.deckCounts,{});
  assert.deepEqual(DeckState.currentDeckCounts(data,15350,()=>({starter:50})),{},
    'zero cards is an intentional edit, not a reason to regenerate the starter deck');
  const underflow=DeckState.adjustDeckCounts(data,'singleCard',-1,4,50);
  assert.equal(underflow.ok,false);
  assert.equal(underflow.reason,'below_zero');
  assert.deepEqual(data.deckCounts,{});
});

test('shared deck quantity adjustment enforces card limit and the 50-card ceiling',()=>{
  const data={deckCounts:{}};
  assert.equal(DeckState.adjustDeckCounts(data,'limited',1,1,50).ok,true);
  assert.equal(DeckState.adjustDeckCounts(data,'limited',1,1,50).reason,'card_limit');
  data.deckCounts=Object.fromEntries(Array.from({length:49},(_,i)=>['existing-'+i,1]));
  const last=DeckState.adjustDeckCounts(data,'newCard',1,4,50);
  assert.equal(last.ok,true);
  assert.equal(last.total,50);
  assert.equal(DeckState.adjustDeckCounts(data,'overflow',1,4,50).reason,'deck_full');
  const fs=require('node:fs');
  const appSource=fs.readFileSync(require.resolve('../app/src/main/assets/game/app.js'),'utf8');
  assert.match(appSource,/FM\.DeckState\.adjustDeckCounts\(data, id, delta, limit, DEMO_DECK_SIZE\)/);
  assert.match(appSource,/if \(deck\.length !== DEMO_DECK_SIZE\)/,
    'editing may save a partial/empty deck while match startup independently requires 50 cards');
});


test('AI healing spell selects the most wounded eligible ally instead of the highest-AP full-health unit',()=>{
  const healthy=unit('ai-heal-healthy',{instanceId:'ai-heal-healthy',ap:9,hp:8,maxHp:8});
  const wounded=unit('ai-heal-wounded',{instanceId:'ai-heal-wounded',ap:2,hp:2,maxHp:8});
  const spell={id:'ai-heal-spell',instanceId:'ai-heal-spell',name:'회복 마법',type:'spell',
    cost:{neutral:0},costKnown:true,costMapped:true,triggerTiming:'공격턴',
    effect:{type:'heal',amount:3,target:'ownUnit'}};
  const p=player('player',{units:[]});
  const ai=player('ai',{units:[healthy,wounded],hand:[spell],unitDeployLimit:0});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal',deckSize:20}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.spells.length,1);
  assert.equal(ai.spells[0].selectedTargetId,'ai-heal-wounded');
});

test('AI damage spell prioritizes an eligible lethal target',()=>{
  const durable=unit('ai-damage-durable',{instanceId:'ai-damage-durable',ap:8,hp:8,maxHp:8});
  const lethal=unit('ai-damage-lethal',{instanceId:'ai-damage-lethal',ap:1,hp:2,maxHp:8});
  const spell={id:'ai-damage-spell',instanceId:'ai-damage-spell',name:'파괴 마법',type:'spell',
    cost:{neutral:0},costKnown:true,costMapped:true,triggerTiming:'공격턴',
    effect:{type:'damage',amount:3,target:'enemyUnit'}};
  const p=player('player',{units:[durable,lethal]});
  const ai=player('ai',{hand:[spell],unitDeployLimit:0});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal',deckSize:20}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.spells.length,1);
  assert.equal(ai.spells[0].selectedTargetId,'ai-damage-lethal');
});


test('AI resolves a lethal spell before spending shared preparation souls on a unit',()=>{
  const enemy=unit('ai-priority-enemy',{instanceId:'ai-priority-enemy',ap:2,dp:0,hp:3,maxHp:3});
  const summon=unit('ai-priority-summon',{instanceId:'ai-priority-summon',cost:{forest:1},
    costKnown:true,costMapped:true,ap:3,dp:2,hp:5,maxHp:5});
  const lethalSpell={id:'ai-priority-spell',instanceId:'ai-priority-spell',name:'마무리 마법',type:'spell',
    cost:{forest:1},costKnown:true,costMapped:true,triggerTiming:'공격턴',
    effect:{type:'damage',amount:3,target:'enemyUnit'}};
  const p=player('player',{units:[enemy]});
  const ai=player('ai',{hand:[summon,lethalSpell],unitDeployLimit:1,
    soulPool:{colored:{forest:2},neutral:0}});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal',deckSize:20}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.spells.length,1,'AI queues the spell');
  assert.equal(ai.spells[0].selectedTargetId,'ai-priority-enemy');
  assert.equal(ai.units.length,1,'AI still summons its unit with the remaining soul');
  const spellLog=s.log.findIndex(entry=>entry.text.includes('마법 마무리 마법'));
  const unitLog=s.log.findIndex(entry=>entry.text.includes('1번 슬롯에 소환했습니다.'));
  assert.ok(spellLog>=0);
  assert.ok(unitLog<spellLog,'logs are newest-first: the later unit deployment must appear before the earlier spell in the log array');
});

test('AI preserves a targeted spell when no legal enemy target exists and spends shared souls on a unit',()=>{
  const summon=unit('ai-no-target-summon',{instanceId:'ai-no-target-summon',cost:{forest:1},
    costKnown:true,costMapped:true,ap:3,dp:2,hp:5,maxHp:5});
  const damageSpell={id:'ai-no-target-spell',instanceId:'ai-no-target-spell',name:'대상 지정 마법',type:'spell',
    cost:{forest:1},costKnown:true,costMapped:true,triggerTiming:'공격턴',
    effect:{type:'damage',amount:3,target:'enemyUnit'}};
  const p=player('player',{units:[]});
  const ai=player('ai',{hand:[summon,damageSpell],unitDeployLimit:1,
    soulPool:{colored:{forest:1},neutral:0}});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal',deckSize:20}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.units.length,1,'AI uses the available soul to deploy a legal unit');
  assert.equal(ai.hand.some(card=>card.instanceId==='ai-no-target-spell'),true,
    'the targeted spell remains in hand because no enemy target is legal');
  assert.equal(ai.spells.length,0,'AI does not queue an invalid-target spell');
});

test('AI buff spell avoids units whose requested stat changes are blocked by Manual markers',()=>{
  const blocked=unit('ai-buff-blocked',{instanceId:'ai-buff-blocked',ap:3,statMarkers:{ap:'*'}});
  const eligible=unit('ai-buff-eligible',{instanceId:'ai-buff-eligible',ap:3,statMarkers:{}});
  const spell={id:'ai-buff-spell',instanceId:'ai-buff-spell',name:'공격 강화 마법',type:'spell',
    cost:{neutral:0},costKnown:true,costMapped:true,triggerTiming:'공격턴',
    effect:{type:'buff',ap:2,target:'ownUnit'}};
  const p=player('player');
  const ai=player('ai',{hand:[spell],units:[blocked,eligible]});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal',deckSize:20}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.spells.length,1);
  assert.equal(ai.spells[0].selectedTargetId,'ai-buff-eligible');
});

test('AI keeps a buff spell when every friendly target blocks its requested stat change',()=>{
  const blocked=unit('ai-buff-only-blocked',{instanceId:'ai-buff-only-blocked',ap:3,statMarkers:{ap:'*'}});
  const spell={id:'ai-buff-only-spell',instanceId:'ai-buff-only-spell',name:'공격 강화 마법',type:'spell',
    cost:{neutral:0},costKnown:true,costMapped:true,triggerTiming:'공격턴',
    effect:{type:'buff',ap:2,target:'ownUnit'}};
  const p=player('player');
  const ai=player('ai',{hand:[spell],units:[blocked]});
  const s=state(p,ai,{activeId:'ai',settings:{difficulty:'normal',deckSize:20}});
  FM.runAIPhase(s,'ai');
  assert.equal(ai.spells.length,0,'AI must not spend a spell that cannot change any target');
  assert.equal(ai.hand.some(card=>card.instanceId==='ai-buff-only-spell'),true);
});
