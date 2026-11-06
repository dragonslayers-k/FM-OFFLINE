#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const Schema = require('../../app/src/main/assets/game/card-schema.js');
const FM = require('../../app/src/main/assets/game/rules.js');

const file = process.argv[2];
const mappingFile = process.argv[3];
const effectFile = process.argv[4];
const skill2File = process.argv[5];
const manifestFile = process.argv[6];
if (!file || !fs.existsSync(file) || !mappingFile || !fs.existsSync(mappingFile) ||
    !effectFile || !fs.existsSync(effectFile) || !skill2File || !fs.existsSync(skill2File) ||
    !manifestFile || !fs.existsSync(manifestFile)) {
  console.error('Usage: node validate-app-card-pack.cjs <cards.json> <card-skill-mappings.json> <card-effect-candidates.json> <skill2-catalogue.json> <manifest.json>');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const cards = Schema.normalizeMany(raw);
const rawCardsById = new Map(raw.map(card => [String(card.id), card]));
const mappingData = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
if (mappingData.schemaVersion !== 1 || !Array.isArray(mappingData.records) ||
    mappingData.recordCount !== mappingData.records.length) {
  throw new Error('card-skill-mappings.json has an invalid schema or record count');
}
const effectData = JSON.parse(fs.readFileSync(effectFile, 'utf8'));
if (effectData.schemaVersion !== 2 || !Array.isArray(effectData.records) ||
    effectData.candidateCount !== effectData.records.length ||
    effectData.clauseCount !== effectData.records.reduce((n,x)=>n+(Array.isArray(x.clauses)?x.clauses.length:0),0)) {
  throw new Error('card-effect-candidates.json has an invalid schema or record count');
}
const skill2Data = JSON.parse(fs.readFileSync(skill2File, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
if (Number(manifest.cardsCount||0)!==15350 || !manifest.sourceDatabase || manifest.sourceDatabase.releaseTag!=='fm1-carddb-29' || Number(manifest.sourceDatabase.cardCount||0)!==15350) {
  throw new Error('manifest.json does not describe the protected DB29 15,350-card baseline');
}
const SKILL2_SOURCE_VERIFIED_RULES = Object.freeze({
  '기선제압': {ruleId:'skill2_tactical_initiative',evidenceNeedle:'데미지를 1 덜 받는다'},
  '헌신방어': {ruleId:'skill2_devoted_defense',evidenceNeedle:'아군 필드 다음 유닛 공방체 +1'},
  '격노': {ruleId:'skill2_frenzy_defense',evidenceNeedle:'자신의 HP가 깎인 수치만큼 AP 상승'},
  '홀리오오라': {ruleId:'skill2_holy_aura',evidenceNeedle:'방/체 합 1/2 이하',cardVerificationNeedle:'방어시 적군 유닛의 AP가 자신 방/체 합 1/2 이하(내림)일경우에는 데미지를 입지 않는다.'},
  '얼라이디펜스': {ruleId:'skill2_alliance_defense',evidenceNeedle:'자신과 동일한 소속의 필드 유닛 수 만큼 받는 데미지 감소'},
  '레이셜디펜스': {ruleId:'skill2_racial_defense',evidenceNeedle:'자신과 동일한 종족의 필드 유닛 수 만큼 받는 데미지 감소'},
  '강한헌신방어': {ruleId:'skill2_strong_devoted_defense',evidenceNeedle:'아군 필드 유닛 전체의 공방체가 1증가한다'},
  '프레셔': {ruleId:'skill2_pressure_defense',evidenceNeedle:'아군 필드 빈공간수 절반(내림) 만큼 받은 데미지를 감소시킨다'}
});
if (skill2Data.schemaVersion !== 1 || skill2Data.sourceField !== 'Skill2' ||
    !Array.isArray(skill2Data.records) || skill2Data.entryCount !== skill2Data.records.length ||
    !Array.isArray(skill2Data.executableRuleIds) ||
    skill2Data.executableRuleCount !== skill2Data.executableRuleIds.length) {
  throw new Error('skill2-catalogue.json has an invalid schema or executable rule ID count');
}
const skillMappingsByCard = new Map();
for (const mapping of mappingData.records) {
  const id = String(mapping.cardId || '');
  if (!id) throw new Error('A card skill mapping has no cardId');
  if (!skillMappingsByCard.has(id)) skillMappingsByCard.set(id, []);
  skillMappingsByCard.get(id).push(mapping);
}
const skill2Expected = new Map();
for (const mapping of mappingData.records) {
  if (mapping.sourceField !== 'Skill2') continue;
  const key = String(mapping.sourceEnumValue || '') + '\\u0000' + String(mapping.sourceName || '');
  if (!skill2Expected.has(key)) skill2Expected.set(key, { enumValue:String(mapping.sourceEnumValue || ''),
    name:String(mapping.sourceName || ''), cardIds:[], statuses:new Set(), candidateRuleIds:new Set() });
  const entry = skill2Expected.get(key);
  entry.cardIds.push(String(mapping.cardId));
  entry.statuses.add(String(mapping.mappingStatus || 'unmapped'));
  if (mapping.ruleId) entry.candidateRuleIds.add(String(mapping.ruleId));
}
const skill2Actual = new Map();
for (const entry of skill2Data.records) {
  const key = String(entry.enumValue || '') + '\\u0000' + String(entry.name || '');
  if (skill2Actual.has(key)) throw new Error('Duplicate Skill2 catalogue entry: ' + key);
  skill2Actual.set(key, entry);
}
if (skill2Actual.size !== skill2Expected.size) {
  throw new Error('Skill2 catalogue enum coverage differs from card-skill-mappings.json');
}
const cardsById = new Map(cards.map(card => [String(card.id), card]));
const skill2Audit = { entries:skill2Data.records.length, activeSkills:0, activeCards:0,
  sourceMappings:0, cardReferences:0, executableRules:0 };
const executableSkill2RuleIds = new Set();
for (const [key, expected] of skill2Expected) {
  const actual = skill2Actual.get(key);
  if (!actual) throw new Error('Missing Skill2 enum from catalogue: ' + key);
  const expectedIds = [...new Set(expected.cardIds)].sort();
  const actualIds = Array.isArray(actual.cardIds) ? actual.cardIds.map(String).sort() : [];
  if (actual.cardCount !== expectedIds.length || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error('Skill2 card coverage mismatch: ' + key);
  }
  const referenceIds = Array.isArray(actual.cardReferences)
    ? actual.cardReferences.map(x => String(x.cardId || '')).sort() : [];
  if (JSON.stringify(referenceIds) !== JSON.stringify(expectedIds)) {
    throw new Error('Skill2 card evidence references do not cover the exact mapped cards: ' + key);
  }
  const expectedStatuses = [...expected.statuses].sort();
  if (JSON.stringify(actual.sourceMappingStatuses) !== JSON.stringify(expectedStatuses)) {
    throw new Error('Skill2 source mapping statuses differ: ' + key);
  }
  if (JSON.stringify([...(actual.sourceCandidateRuleIds || [])].sort()) !==
      JSON.stringify([...expected.candidateRuleIds].sort())) {
    throw new Error('Skill2 candidate rule provenance differs: ' + key);
  }
  const verifiedSpec=SKILL2_SOURCE_VERIFIED_RULES[actual.name];
  const evidenceNeedle=verifiedSpec
    ? (verifiedSpec.cardVerificationNeedle || verifiedSpec.evidenceNeedle) : null;
  const refsById=new Map((actual.cardReferences||[]).map(ref=>[String(ref.cardId),ref]));
  const expectedEvidenceIds=(actual.cardReferences||[])
    .filter(ref=>ref.cardType==='unit' && evidenceNeedle &&
      String(ref.description||'').includes(evidenceNeedle))
    .map(ref=>String(ref.cardId)).sort();
  if (verifiedSpec && expectedEvidenceIds.length) {
    if (actual.ruleId !== verifiedSpec.ruleId || actual.ruleAuthority !== 'card_source' ||
        actual.verificationStatus !== 'source_card_verified' ||
        actual.executionStatus !== 'source-card-rule-implemented' ||
        actual.trigger == null || actual.mechanic == null) {
      throw new Error('Skill2 source-verified rule metadata mismatch: ' + key);
    }
    const evidenceIds=[...(actual.evidenceCardIds||[])].map(String).sort();
    if (!evidenceIds.length || JSON.stringify(evidenceIds)!==JSON.stringify(expectedEvidenceIds) ||
        evidenceIds.some(id=>!refsById.has(id))) {
      throw new Error('Skill2 verified rule evidence card list is incomplete or not exact: ' + key);
    }
    if (actual.evidenceSource !== 'fmlunatic-card-detail-description' ||
        actual.evidenceUrl !== 'https://fmlunatic.com/cardlist') {
      throw new Error('Skill2 rule evidence source metadata mismatch: ' + key);
    }
    executableSkill2RuleIds.add(actual.ruleId);
    skill2Audit.executableRules++;
  } else {
    const expectedNoSkill=actual.name === '' || actual.name === '없음' ||
      (Array.isArray(actual.sourceMappingStatuses) &&
       actual.sourceMappingStatuses.length === 1 &&
       actual.sourceMappingStatuses[0] === 'no_special_skill');
    if (actual.ruleId !== null || actual.ruleAuthority !== null ||
        actual.verificationStatus !== (expectedNoSkill ? 'no_special_skill' : 'extracted_unverified') ||
        actual.executionStatus !== (expectedNoSkill ? 'no-skill' : 'disabled-until-skill2-rule-review') ||
        (actual.evidenceCardIds||[]).length !== 0 ||
        actual.mechanic !== null || actual.trigger !== null) {
      throw new Error('Unverified Skill2 entry must remain non-executable: ' + key);
    }
  }
  if (actual.verificationStatus !== 'no_special_skill') skill2Audit.activeSkills++;
  skill2Audit.sourceMappings += expected.cardIds.length;
  skill2Audit.cardReferences += (actual.cardReferences || []).length;
  for (const ref of actual.cardReferences || []) {
    const card = cardsById.get(String(ref.cardId));
    const rawCard = rawCardsById.get(String(ref.cardId));
    // Evidence references deliberately preserve exact source HTML/text. Compare
    // them with the raw pack record, not the normalized display text (which has
    // tags/entities/line breaks decoded for rendering).
    if (!rawCard) {
      throw new Error('Skill2 card evidence references a missing raw card: ' + String(ref.cardId));
    }
    // Compare every evidence field with the original cards.json record. The
    // normalized card is a display/runtime object: it decodes HTML, canonicalizes
    // faction/ability names, and coerces stats. Comparing raw evidence to that
    // transformed object creates false mismatches even when the source record
    // and evidence reference are byte-for-byte semantically identical.
    const rawEvidenceFields = [
      ['sourceCardUrl', rawCard.sourceCardUrl ?? null],
      ['sourceListUrl', rawCard.sourceListUrl ?? null],
      ['cardType', rawCard.type ?? null],
      ['name', rawCard.name ?? null],
      ['text', rawCard.text || ''],
      ['description', rawCard.description || ''],
      ['faction', rawCard.faction ?? null],
      ['unitAbility', rawCard.unitAbility ?? null],
      ['skill1', rawCard.specialSkill1 ?? null],
      ['skill2', rawCard.specialSkill2 ?? ''],
      ['skill2EnumValue', rawCard.specialSkill2EnumValue ?? null],
      ['skill2MappingStatus', rawCard.specialSkill2MappingStatus ?? null],
      ['skill2SourceMappingStatus', rawCard.specialSkill2SourceMappingStatus ?? null],
      ['skill2RuleId', rawCard.specialSkill2RuleId ?? null],
      ['skill2RuleAuthority', rawCard.specialSkill2RuleAuthority ?? null],
      ['skill2ExecutionStatus', rawCard.specialSkill2ExecutionStatus ?? null],
      ['level', rawCard.level ?? null],
      ['ap', rawCard.ap ?? null],
      ['dp', rawCard.dp ?? null],
      ['hp', rawCard.hp ?? null],
      ['effectCandidateCount', rawCard.effectCandidateCount ?? 0]
    ];
    const mismatchedFields = rawEvidenceFields
      .filter(([field, expectedValue]) => ref[field] !== expectedValue)
      .map(([field]) => field);
    if (mismatchedFields.length) {
      throw new Error('Skill2 card raw evidence mismatch: ' + String(ref.cardId) +
        ' fields: ' + mismatchedFields.join(', '));
    }
  }
}
const activeSkill2CardIds = new Set(skill2Data.records
  .filter(x => x.verificationStatus !== 'no_special_skill')
  .flatMap(x => x.cardIds || []));
const noSkill2CardIds = new Set(skill2Data.records
  .filter(x => x.verificationStatus === 'no_special_skill')
  .flatMap(x => x.cardIds || []));
skill2Audit.activeCards = activeSkill2CardIds.size;
if (skill2Audit.sourceMappings !== skill2Data.mappingRecordCount ||
    skill2Audit.executableRules !== Number(skill2Data.executableRuleCount || 0) ||
    executableSkill2RuleIds.size !== Number(skill2Data.executableRuleCount || 0) ||
    JSON.stringify([...(skill2Data.executableRuleIds || [])].sort()) !==
      JSON.stringify([...executableSkill2RuleIds].sort()) ||
    skill2Data.activeSkillCount !== skill2Audit.activeSkills ||
    skill2Data.activeCardCount !== skill2Audit.activeCards ||
    skill2Data.noSkillCardCount !== noSkill2CardIds.size ||
    skill2Data.mappingStatusCounts == null ||
    Object.values(skill2Data.mappingStatusCounts).reduce((n,v)=>n+Number(v||0),0) !== skill2Data.mappingRecordCount) {
  throw new Error('Skill2 catalogue summary counts mismatch: ' + JSON.stringify(skill2Audit));
}
const effectCandidatesByCard = new Map();
for (const candidate of effectData.records) {
  const id = String(candidate.cardId || '');
  if (!id) throw new Error('An effect candidate has no cardId');
  if (!effectCandidatesByCard.has(id)) effectCandidatesByCard.set(id, []);
  effectCandidatesByCard.get(id).push(candidate);
}
const EXPECTED = { land:289, unit:8633, spell:3857, item:1748, enchant:823 };
const types = Object.create(null);
const costKnown = Object.create(null);
const playable = Object.create(null);
const blocked = Object.create(null);
const landStatus = Object.create(null);
const landInstallCost = { known:0, review:0, mappingReview:0, semanticReview:0, runtimeReady:0 };
const runtimeCostStatus = Object.create(null);
const runtimeEffectDisposition = Object.create(null);
const runtimePlayable = { ready:0, blocked:0 };
const effectAudit = { candidates:0, clauses:0, candidateOnlyCards:0, unexpectedExecutableEffects:0, spanErrors:0, runtimeDispositions:Object.create(null) };
const skillAudit = { mappingRows:0, manualVerifiedMappings:0, communityCandidates:0, unmapped:0,
  noSkill:0, communityRuleExecution:0, manualRuleCards:0 };
const errors = [];
const runtimeActionAudit = { attempted:0, completed:0, blocked:0, terminalStates:Object.create(null), byType:Object.create(null) };
function makeProbePlayer(id) {
  return {
    id, name:id, isAI:id==='ai',
    deck:Array.from({length:30},(_,i)=>({id:id+'-probe-deck-'+i})),
    hand:[], lands:[], units:[], spells:[], graveyard:[],
    lp:999999, soulSpent:0, playedLand:false,
    soulPool:{colored:{dark:999,fire:999,water:999,forest:999,metal:999,earth:999,light:999},neutral:999},
    neutralUpkeep:0, unitDeployLimit:9999, unitDeployedThisPhase:0,
    playedAnyCardThisPhase:false, reshuffleUsedRound:0
  };
}
function makeProbeUnit(instanceId, ownerId, race, affiliation) {
  return {
    id:instanceId, instanceId, ownerId, name:'Runtime probe unit', type:'unit',
    ap:5, dp:5, hp:10, maxHp:10, slotIndex:1,
    race:String(race||'버드'), affiliation:String(affiliation||'일반'),
    specialSkill1Name:'', specialSkill2Name:'', abilities:[], equipment:[]
  };
}
function probeRuntimeAction(sourceCard) {
  const card=JSON.parse(JSON.stringify(sourceCard));
  const instanceId=String(card.id)+'-runtime-probe';
  card.instanceId=instanceId;
  const owner=makeProbePlayer('player');
  const opponent=makeProbePlayer('ai');
  const condition=card.itemConditions||{};
  const race=condition.race||'버드';
  const affiliation=condition.affiliation||'일반';
  const ownTarget=makeProbeUnit('runtime-own-target','player',race,affiliation);
  const enemyTarget=makeProbeUnit('runtime-enemy-target','ai',race,affiliation);
  const allowedAbilities=Array.isArray(card.allowedUnitAbilities)?card.allowedUnitAbilities:[];
  for(const target of [ownTarget,enemyTarget]){
    target.unitAbilityTags=allowedAbilities.slice();
    target.unitAbility=allowedAbilities[0]||'';
    target.unitType=allowedAbilities[0]||'';
    target.subtype=allowedAbilities[0]||'';
  }
  owner.units.push(ownTarget);
  opponent.units.push(enemyTarget);
  const state={
    status:'playing',round:1,attackerId:'player',activeId:'player',
    prepared:{player:false,ai:false},players:{player:owner,ai:opponent},
    log:[],rng:()=>0.1
  };
  owner.hand.push(card);
  let targetId=null;
  if(card.type==='item') {
    targetId=condition.owner==='enemy'?enemyTarget.instanceId:ownTarget.instanceId;
  } else if(card.type==='spell' && card.runtimeEffectDisposition!=='fallback_noop' && card.effect) {
    if(card.effect.target==='ownUnit')targetId=ownTarget.instanceId;
    else if(card.effect.target==='enemyUnit')targetId=enemyTarget.instanceId;
  }
  const result=FM.playCard(state,'player',instanceId,targetId);
  const remainsInHand=owner.hand.some(x=>x.instanceId===instanceId);
  let terminalState=false, terminalLabel='';
  if(card.type==='land') { terminalState=owner.lands.some(x=>x.instanceId===instanceId); terminalLabel='land_installed'; }
  else if(card.type==='unit') { terminalState=owner.units.some(x=>x.instanceId===instanceId); terminalLabel='unit_summoned'; }
  else if(card.type==='spell') {
    terminalState=owner.spells.some(x=>x.instanceId===instanceId)||owner.graveyard.some(x=>x.instanceId===instanceId);
    terminalLabel=owner.spells.some(x=>x.instanceId===instanceId)?'spell_queued':'spell_fallback_terminal';
  } else if(card.type==='item') {
    terminalState=owner.graveyard.some(x=>x.instanceId===instanceId)||
      ownTarget.equipment.includes(card.name)||enemyTarget.equipment.includes(card.name);
    terminalLabel=owner.graveyard.some(x=>x.instanceId===instanceId)?'item_fallback_terminal':'item_equipped';
  } else if(card.type==='enchant') {
    terminalState=owner.graveyard.some(x=>x.instanceId===instanceId);
    terminalLabel='enchant_fallback_terminal';
  }
  return {ok:!!(result&&result.ok)&&!remainsInHand&&terminalState&&owner.playedAnyCardThisPhase,
    reason:result&&result.reason||(!owner.playedAnyCardThisPhase?'phase action flag was not completed':'action did not reach a terminal state'),
    terminalLabel,remainsInHand,playedAnyCardThisPhase:owner.playedAnyCardThisPhase};
}

for (const card of cards) {
  types[card.type] = (types[card.type] || 0) + 1;
  const validation = FM.validateCardForPlay(card);
  playable[card.type] = playable[card.type] || { ok:0, blocked:0 };
  runtimeActionAudit.attempted++;
  runtimeActionAudit.byType[card.type]=runtimeActionAudit.byType[card.type]||{completed:0,blocked:0};
  const actionProbe=probeRuntimeAction(card);
  if(actionProbe.ok){
    runtimeActionAudit.completed++;
    runtimeActionAudit.byType[card.type].completed++;
    runtimeActionAudit.terminalStates[actionProbe.terminalLabel]=(runtimeActionAudit.terminalStates[actionProbe.terminalLabel]||0)+1;
  }else{
    runtimeActionAudit.blocked++;
    runtimeActionAudit.byType[card.type].blocked++;
    errors.push(card.id+': runtime action did not complete: '+String(actionProbe.reason)+'; handRemains='+actionProbe.remainsInHand+'; terminal='+actionProbe.terminalLabel);
  }
  if (validation.ok) playable[card.type].ok++;
  else {
    playable[card.type].blocked++;
    const reason = String(validation.reason || 'unknown');
    blocked[reason] = (blocked[reason] || 0) + 1;
  }

  if (card.sourceCardUrl !== 'https://fmlunatic.com/card/' + card.id) {
    errors.push(card.id + ': sourceCardUrl does not match the T SQLite document ID');
  }
  if (!card.sourceListUrl || !card.sourceImageUrls ||
      !card.sourceImageUrls.large || !card.sourceImageUrls.small) {
    errors.push(card.id + ': exact source list/image URLs are missing');
  }
  if (!card.sourceImageSha256 || !/^[a-f0-9]{64}$/i.test(card.sourceImageSha256.large || '')) {
    errors.push(card.id + ': large-image SHA-256 from T SQLite is missing');
  }
  if (card.artImageSha256 && card.sourceImageSha256 &&
      card.artImageSha256 !== card.sourceImageSha256.large) {
    errors.push(card.id + ': extracted large-image SHA-256 differs from T SQLite');
  }

  const skillMappings = skillMappingsByCard.get(card.id) || [];
  skillAudit.mappingRows += skillMappings.length;
  let expectedSkill1RuleId = null;
  for (const mapping of skillMappings) {
    if (mapping.mappingStatus === 'manual_verified' && mapping.ruleAuthority === 'manual' &&
        mapping.sourceField === 'Skill1' && mapping.ruleId) {
      expectedSkill1RuleId = mapping.ruleId;
      skillAudit.manualVerifiedMappings++;
    } else if (mapping.mappingStatus === 'community_documented_candidate') {
      skillAudit.communityCandidates++;
      if (mapping.sourceField === 'Skill1' && card.specialSkillRuleId === mapping.ruleId) {
        skillAudit.communityRuleExecution++;
        errors.push(card.id + ': community-only Skill1 candidate is marked executable');
      }
    } else if (mapping.mappingStatus === 'unmapped') {
      skillAudit.unmapped++;
    } else if (mapping.mappingStatus === 'no_special_skill') {
      skillAudit.noSkill++;
    }
  }
  const sourceSkill1 = skillMappings.find(x => x.sourceField === 'Skill1');
  const expectedMappingStatus = sourceSkill1 ? sourceSkill1.mappingStatus : 'no_special_skill';
  if (card.type === 'unit') {
    const sourceSkill2 = skillMappings.find(x => x.sourceField === 'Skill2');
    const expectedSkill2SourceStatus = sourceSkill2 ? sourceSkill2.mappingStatus : 'no_special_skill';
    const expectedSkill2Name = sourceSkill2?.sourceName || '';
    const expectedSkill2Spec = SKILL2_SOURCE_VERIFIED_RULES[expectedSkill2Name] || null;
    const skill2EvidenceNeedle = expectedSkill2Spec
      ? (expectedSkill2Spec.cardVerificationNeedle || expectedSkill2Spec.evidenceNeedle) : null;
    const expectedSkill2Rule = expectedSkill2Spec && card.type === 'unit' &&
      skill2EvidenceNeedle && String(card.description || '').includes(skill2EvidenceNeedle)
      ? expectedSkill2Spec : null;
    const expectedSkill2Status = expectedSkill2Rule ? 'source_card_verified' :
      (expectedSkill2Name && expectedSkill2Name !== '없음' ? 'unmapped' : 'no_special_skill');
    if (card.specialSkill2SourceMappingStatus !== expectedSkill2SourceStatus ||
        card.specialSkill2MappingStatus !== expectedSkill2Status) {
      errors.push(card.id + ': compact Skill2 mapping status does not match source mapping/review rule');
    }
    if (String(card.specialSkill2EnumValue ?? '') !== String(sourceSkill2?.sourceEnumValue ?? '')) {
      errors.push(card.id + ': compact Skill2 enum value does not match card-skill-mappings.json');
    }
    if ((card.specialSkill2 || '') !== expectedSkill2Name) {
      errors.push(card.id + ': compact Skill2 name does not match card-skill-mappings.json');
    }
    if (card.specialSkill2RuleId !== (expectedSkill2Rule?.ruleId || null) ||
        card.specialSkill2RuleAuthority !== (expectedSkill2Rule ? 'card_source' : null) ||
        card.specialSkill2ExecutionStatus !== (expectedSkill2Rule ? 'source-card-rule-implemented' :
          ((card.specialSkill2 && card.specialSkill2 !== '없음')
            ? 'disabled-until-skill2-rule-review' : 'no-skill'))) {
      errors.push(card.id + ': Skill2 executable rule metadata is not source-verified');
    }
    if (card.specialSkillMappingStatus !== expectedMappingStatus) {
      errors.push(card.id + ': compact Skill1 mapping status does not match card-skill-mappings.json');
    }
    if (card.specialSkillRuleAuthority !== (sourceSkill1?.ruleAuthority || null)) {
      errors.push(card.id + ': compact Skill1 authority does not match card-skill-mappings.json');
    }
    if (card.specialSkillRuleId !== expectedSkill1RuleId) {
      errors.push(card.id + ': specialSkillRuleId does not match a Manual-verified Skill1 mapping');
    }
    if (expectedSkill1RuleId) skillAudit.manualRuleCards++;
  } else if (card.specialSkillRuleId) {
    errors.push(card.id + ': non-unit card has an executable unit special-skill rule ID');
  }

  const effectCandidates = effectCandidatesByCard.get(card.id) || [];
  if (Number(card.effectCandidateCount || 0) !== effectCandidates.length) {
    errors.push(card.id + ': compact effect candidate count does not match external candidate file');
  }
  for (const candidate of effectCandidates) {
    effectAudit.candidates++;
    if (candidate.verificationStatus !== 'pattern_candidate') {
      errors.push(card.id + ': effect candidate was promoted without rule verification');
    }
    if (!['exact','not_split'].includes(candidate.spanIntegrityStatus)) {
      effectAudit.spanErrors++;
      errors.push(card.id + ': effect source span has no integrity proof');
    }
    if (candidate.sourceCardUrl !== card.sourceCardUrl) {
      errors.push(card.id + ': effect candidate source URL does not match its card');
    }
    const clauses = Array.isArray(candidate.clauses) ? candidate.clauses : [];
    effectAudit.clauses += clauses.length;
    for (const clause of clauses) {
      const disposition=String(clause.runtimeDisposition||'');
      if (!['implemented_verified','implemented_inferred','fallback_noop','not_applicable'].includes(disposition)) {
        errors.push(card.id + ': effect clause has no terminal runtime disposition');
      } else {
        effectAudit.runtimeDispositions[disposition]=(effectAudit.runtimeDispositions[disposition]||0)+1;
        if (disposition==='implemented_inferred' && card.runtimeEffectDisposition!=='implemented_inferred') {
          errors.push(card.id + ': inferred clause disposition does not match card runtime handler');
        }
      }
    }
    if (candidate.spanIntegrityStatus === 'exact') {
      const expectedText = Array.isArray(candidate.analysis?.clause_candidates)
        ? candidate.analysis.clause_candidates.map(x => String(x.text || '')).join('')
        : null;
      const actualText = clauses.map(x => String(x.text || '')).join('');
      if (expectedText === null || expectedText !== actualText) {
        effectAudit.spanErrors++;
        errors.push(card.id + ': effect clause text is not lossless');
      }
    }
  }
  if (card.effectExecutionStatus === 'candidate-only') effectAudit.candidateOnlyCards++;
  if (card.effectExecutionStatus === 'candidate-only' && card.effect && card.runtimeEffectDisposition !== 'implemented_inferred') {
    effectAudit.unexpectedExecutableEffects++;
    errors.push(card.id + ': candidate-only source effect has no explicit tested inferred runtime disposition');
  }
  if (card.runtimeEffectDisposition === 'implemented_inferred' && !card.effect) {
    errors.push(card.id + ': inferred runtime effect disposition has no parsed handler');
  }
  if (effectCandidates.length && card.effectVerificationStatus !== 'pattern_candidate') {
    errors.push(card.id + ': compact effect verification status does not match candidate file');
  }

  const runtimeCost = card.type === 'land' ? card.landInstallCost : card.runtimeCost;
  const runtimeCostKnown = card.type === 'land' ? card.landInstallCostKnown === true : card.runtimeCostKnown === true;
  const runtimeCostParsed = FM._test.readCost(runtimeCost);
  if (runtimeCostKnown && runtimeCostParsed.ok) {
    runtimePlayable.ready++;
    const status = String(card.runtimeCostStatus || 'missing');
    runtimeCostStatus[status] = (runtimeCostStatus[status] || 0) + 1;
    if (Object.prototype.hasOwnProperty.call(runtimeCost || {}, 'bonus')) {
      errors.push(card.id + ': unsupported BONUS key leaked into runtime payment cost');
    }
  } else {
    runtimePlayable.blocked++;
    errors.push(card.id + ': runtime payment cost is missing or invalid: ' + (runtimeCostParsed.reason || 'unknown'));
  }
  if (card.type === 'unit') {
    const upkeep = FM._test.readCost(card.runtimeUpkeepCost);
    if (!upkeep.ok) errors.push(card.id + ': runtime upkeep profile is missing or invalid');
  }
  if (card.runtimeEffectDisposition) {
    const disposition = String(card.runtimeEffectDisposition);
    runtimeEffectDisposition[disposition] = (runtimeEffectDisposition[disposition] || 0) + 1;
    if (['spell','enchant'].includes(card.type) && !['implemented_verified','implemented_inferred','fallback_noop'].includes(disposition)) {
      errors.push(card.id + ': spell/enchant has no terminal runtime effect disposition');
    }
    if (card.type==='enchant' && disposition!=='fallback_noop') {
      errors.push(card.id + ': enchant has no supported event/duration runtime handler and must use fallback_noop');
    }
    if (card.type==='spell' && disposition==='implemented_inferred' &&
        !/전투시작|전투개시|공격|공격턴|방어|방어턴/.test(String(card.triggerTiming||'').replace(/\s/g,''))) {
      errors.push(card.id + ': inferred spell handler has unsupported trigger timing');
    }
  }

  if (card.type === 'land') {
    landStatus[card.soulProductionStatus || 'missing'] =
      (landStatus[card.soulProductionStatus || 'missing'] || 0) + 1;
    if (card.costTokenParsed === true && !card.costMappingReview && !card.costSemanticReview) landInstallCost.known++;
    else landInstallCost.review++;
    if (card.costMappingReview) landInstallCost.mappingReview++;
    if (card.costSemanticReview) landInstallCost.semanticReview++;
    if (runtimeCostKnown && runtimeCostParsed.ok) landInstallCost.runtimeReady++;
    if (card.requiredLPKnown !== true) errors.push(card.id + ': LP source value not marked known');
    if (card.soulProductionStatus === 'magicland-effect') {
      if (card.runtimeLandProductionStatus !== 'fallback_noop') errors.push(card.id + ': MagicLand effect has no deterministic runtime fallback');
      const output=card.soulProduction||{};
      if (Object.values(output.colored||{}).some(v=>Number(v)>0)||Number(output.neutral||0)>0) {
        errors.push(card.id + ': MagicLand fallback must not invent ordinary soul production');
      }
    }
    if (card.soulProductionStatus === 'source-decoded' && card.landInstallCostKnown === true && !validation.ok) {
      errors.push(card.id + ': decoded ordinary land blocked: ' + validation.reason);
    }
    if (card.landInstallCostKnown !== true && validation.ok) errors.push(card.id + ': runtime land installation cost incorrectly missing');
  } else {
    costKnown[card.type] = costKnown[card.type] || { known:0, review:0, mappingReview:0, semanticReview:0 };
    if (card.costKnown === true && card.costMapped === true) {
      costKnown[card.type].known++;
      if (card.costMappingReview || card.costSemanticReview) errors.push(card.id + ': reviewed source cost is incorrectly marked source-verified');
    } else {
      costKnown[card.type].review++;
      if (card.costMappingReview) costKnown[card.type].mappingReview++;
      if (card.costSemanticReview) costKnown[card.type].semanticReview++;
    }
  }
  if (!validation.ok) errors.push(card.id + ': card cannot enter a playable action: ' + String(validation.reason || 'unknown'));
}

if (runtimeActionAudit.attempted !== 15350 || runtimeActionAudit.completed !== 15350 || runtimeActionAudit.blocked !== 0) {
  errors.push('Runtime action terminal-state coverage mismatch: ' + JSON.stringify(runtimeActionAudit));
}

for (const [type, count] of Object.entries(EXPECTED)) {
  if (types[type] !== count) errors.push(type + ' count mismatch: ' + types[type] + ' / ' + count);
}
if (cards.length !== 15350) errors.push('Total card count mismatch: ' + cards.length);
if ((landStatus['source-decoded'] || 0) !== 239) errors.push('Expected 239 decoded standard lands');
if ((landStatus['magicland-effect'] || 0) !== 50) errors.push('Expected 50 MagicLand special-effect records');
if (landInstallCost.known !== 275 || landInstallCost.review !== 14 ||
    landInstallCost.mappingReview !== 14 || landInstallCost.semanticReview !== 0) {
  errors.push('Land install-cost review accounting mismatch: ' + JSON.stringify(landInstallCost));
}
const nonLandKnown = Object.values(costKnown).reduce((s,x) => s + x.known, 0);
const nonLandReview = Object.values(costKnown).reduce((s,x) => s + x.review, 0);
const mappingReviewNonLand = Object.values(costKnown).reduce((s,x) => s + x.mappingReview, 0);
const semanticReviewNonLand = Object.values(costKnown).reduce((s,x) => s + x.semanticReview, 0);
if (nonLandKnown !== 14244 || nonLandReview !== 817 ||
    mappingReviewNonLand !== 38 || semanticReviewNonLand !== 779) {
  errors.push('Non-land cost status accounting mismatch: ' + JSON.stringify(costKnown));
}
if (effectAudit.candidates !== 17407 || effectAudit.clauses !== 48281 ||
    Object.values(effectAudit.runtimeDispositions).reduce((n,v)=>n+Number(v||0),0)!==48281 ||
    JSON.stringify(effectData.runtimeClauseDispositionCounts||{})!==JSON.stringify(effectAudit.runtimeDispositions) ||
    effectAudit.spanErrors !== 0 || effectAudit.unexpectedExecutableEffects !== 0) {
  errors.push('Effect candidate audit mismatch: ' + JSON.stringify(effectAudit));
}
const manifestEffectReview=manifest.effectReview||{};
if (JSON.stringify(manifestEffectReview.runtimeClauseDispositionCounts||{})!==JSON.stringify(effectAudit.runtimeDispositions)) {
  errors.push('Manifest effect clause runtime disposition counts do not match effect-candidates.json.');
}
if (Number(manifestEffectReview.runtimeInferredClauseCount||0)!==Number(effectAudit.runtimeDispositions.implemented_inferred||0) ||
    Number(manifestEffectReview.runtimeFallbackClauseCount||0)!==Number(effectAudit.runtimeDispositions.fallback_noop||0)) {
  errors.push('Manifest inferred/fallback clause counts do not match effect-candidates.json.');
}
if (JSON.stringify(manifestEffectReview.runtimeCardEffectDispositionCounts||{})!==JSON.stringify(runtimeEffectDisposition)) {
  errors.push('Manifest card-level effect dispositions do not match normalized cards.');
}
if (skillAudit.mappingRows < 15000 || skillAudit.manualVerifiedMappings < 1000 ||
    skillAudit.communityCandidates < 100 || skillAudit.communityRuleExecution !== 0) {
  errors.push('Special-skill mapping validation mismatch: ' + JSON.stringify(skillAudit));
}
if (errors.length) {
  console.error(JSON.stringify({errors:errors.slice(0,50),errorCount:errors.length,types,landStatus,landInstallCost,runtimeCostStatus,runtimePlayable,runtimeEffectDisposition,runtimeActionAudit,costKnown,playable,effectAudit,skillAudit},null,2));
  process.exit(1);
}
console.log(JSON.stringify({
  status:'PASS',
  cards:cards.length,
  categories:types,
  nonLandCostKnown:nonLandKnown,
  nonLandCostNeedsReview:nonLandReview,
  nonLandMappingReview:mappingReviewNonLand,
  nonLandSemanticReview:semanticReviewNonLand,
  nonLandCostsByType:costKnown,
  standardLands:landStatus['source-decoded'],
  magicLandEffectRecords:landStatus['magicland-effect'],
  landInstallCost,
  runtimeCostStatus,
  runtimeCostCoverage:runtimePlayable,
  runtimeEffectDisposition,
  runtimeActionAudit,
  playableByType:playable,
  blockedReasons:blocked,
  effectAudit,
  skillAudit,
  skill2Audit
},null,2));
