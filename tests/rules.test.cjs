const test=require('node:test');
const assert=require('node:assert/strict');
const FM=require('../app/src/main/assets/game/rules.js');

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

test('MagicLand is not installed as a normal producing land until its recurring effect is implemented',()=>{
  const card={id:'magic-land',instanceId:'ml',name:'빛의성벽',type:'land',
    requiredLP:0,requiredLPKnown:true,landInstallCost:{neutral:0},landInstallCostKnown:true,
    soulProduction:{colored:{},neutral:0},soulProductionStatus:'magicland-effect',isMagicLand:true};
  const p=player('player',{hand:[card],lp:1,soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','ml');
  assert.equal(result.ok,false);
  assert.match(result.reason,/매직랜드/);
  assert.equal(p.lp,1);
  assert.equal(p.hand.length,1);
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

test('unparsed native item target restrictions fail closed',()=>{
  const item={id:'unknown-item',instanceId:'unknown1',name:'조건 미해석 아이템',type:'item',
    cost:{forest:0},costKnown:true,costMapped:true,allowedUnitAbilities:['만능'],itemConditions:{owner:'own',race:null,affiliation:null,unsupported:['race'],mapped:false}};
  const target=unit('target',{instanceId:'t1',race:'버드'});
  const p=player('player',{hand:[item],units:[target],soulPool:{colored:{},neutral:0}});
  const s=state(p,player('ai'));
  const result=FM.playCard(s,'player','unknown1','t1');
  assert.equal(result.ok,false);
  assert.equal(p.hand.length,1);
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

test('AI completes its preparation phase and yields to the player',()=>{
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

test('a card with numeric cost but no verified original cost flag cannot be played',()=>{
  const card={...unit('unverified'),instanceId:'unverified-1',cost:{forest:0},costKnown:false,costMapped:false};
  const p=player('player',{hand:[card],soulPool:{colored:{forest:10},neutral:10},unitDeployLimit:10});
  const result=FM.playCard(state(p,player('ai')),'player','unverified-1');
  assert.equal(result.ok,false);
  assert.match(result.reason,/소울 구슬 비용/);
  assert.equal(p.hand.length,1);
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


test('a missing or empty source cost is not silently treated as free',()=>{
  const missing={...unit('missing-cost'),instanceId:'missing-cost-1',cost:null,costKnown:false,costMapped:false};
  const empty={...unit('empty-cost'),instanceId:'empty-cost-1',cost:{},costKnown:true,costMapped:true};
  const p=player('player',{hand:[missing,empty],soulPool:{colored:{forest:10},neutral:10},unitDeployLimit:10});
  const s=state(p,player('ai'));
  assert.equal(FM.playCard(s,'player','missing-cost-1').ok,false);
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

test('candidate-only enchant effects are blocked until a verified handler exists',()=>{
  const card={id:'candidate-enchant',instanceId:'candidate-enchant-1',name:'후보 인챈트',type:'enchant',
    cost:{fire:1},costKnown:true,costMapped:true,slotIndex:1,slotOwner:'own',
    effectExecutionStatus:'candidate-only',effectVerificationStatus:'pattern_candidate',
    effectCandidates:[{verificationStatus:'pattern_candidate'}]};
  const result=FM.validateCardForPlay(card);
  assert.equal(result.ok,false);
  assert.match(result.reason,/검증되기 전까지 실행을 차단/);
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
  assert.equal(event.fieldIndex,2);
  assert.equal(event.snapshot.hp,4,'event snapshot is isolated from later board mutation');
  assert.deepEqual(event.payload,{destroyed:true});
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
    assert.equal(s.combatEventQueue.size(),0);
  }
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
    assert.equal(s.combatEventQueue.size(),0);
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
