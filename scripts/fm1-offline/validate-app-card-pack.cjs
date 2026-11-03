#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const Schema = require('../../app/src/main/assets/game/card-schema.js');
const FM = require('../../app/src/main/assets/game/rules.js');

const file = process.argv[2];
const mappingFile = process.argv[3];
const effectFile = process.argv[4];
const skill2File = process.argv[5];
if (!file || !fs.existsSync(file) || !mappingFile || !fs.existsSync(mappingFile) ||
    !effectFile || !fs.existsSync(effectFile) || !skill2File || !fs.existsSync(skill2File)) {
  console.error('Usage: node validate-app-card-pack.cjs <cards.json> <card-skill-mappings.json> <card-effect-candidates.json> <skill2-catalogue.json>');
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
if (effectData.schemaVersion !== 1 || !Array.isArray(effectData.records) ||
    effectData.candidateCount !== effectData.records.length ||
    effectData.clauseCount !== effectData.records.reduce((n,x)=>n+(Array.isArray(x.clauses)?x.clauses.length:0),0)) {
  throw new Error('card-effect-candidates.json has an invalid schema or record count');
}
const skill2Data = JSON.parse(fs.readFileSync(skill2File, 'utf8'));
if (skill2Data.schemaVersion !== 1 || skill2Data.sourceField !== 'Skill2' ||
    !Array.isArray(skill2Data.records) || skill2Data.entryCount !== skill2Data.records.length ||
    skill2Data.executableRuleCount !== 0) {
  throw new Error('skill2-catalogue.json has an invalid schema or attempts to enable unverified Skill2 rules');
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
  if (actual.ruleId !== null || actual.ruleAuthority !== null ||
      actual.executionStatus !== (actual.verificationStatus === 'no_special_skill'
        ? 'no-skill' : 'disabled-until-skill2-rule-review')) {
    skill2Audit.executableRules++;
    throw new Error('Skill2 entry must remain non-executable: ' + key);
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
    if (!card || !rawCard || ref.sourceCardUrl !== card.sourceCardUrl ||
        ref.sourceListUrl !== card.sourceListUrl || ref.name !== card.name ||
        ref.text !== (rawCard.text || '') || ref.description !== (rawCard.description || '') ||
        ref.faction !== card.faction || ref.unitAbility !== card.unitAbility ||
        ref.level !== card.level || ref.ap !== card.ap || ref.dp !== card.dp || ref.hp !== card.hp) {
      throw new Error('Skill2 card raw evidence link/text mismatch: ' + String(ref.cardId));
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
    skill2Audit.executableRules !== 0 || skill2Data.activeSkillCount !== skill2Audit.activeSkills ||
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
const landInstallCost = { known:0, review:0, mappingReview:0, semanticReview:0 };
const effectAudit = { candidates:0, clauses:0, candidateOnlyCards:0, unexpectedExecutableEffects:0, spanErrors:0 };
const skillAudit = { mappingRows:0, manualVerifiedMappings:0, communityCandidates:0, unmapped:0,
  noSkill:0, communityRuleExecution:0, manualRuleCards:0 };
const errors = [];

for (const card of cards) {
  types[card.type] = (types[card.type] || 0) + 1;
  const validation = FM.validateCardForPlay(card);
  playable[card.type] = playable[card.type] || { ok:0, blocked:0 };
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
    const expectedSkill2Status = sourceSkill2 ? sourceSkill2.mappingStatus : 'no_special_skill';
    if (card.specialSkill2MappingStatus !== expectedSkill2Status) {
      errors.push(card.id + ': compact Skill2 mapping status does not match card-skill-mappings.json');
    }
    if (String(card.specialSkill2EnumValue ?? '') !== String(sourceSkill2?.sourceEnumValue ?? '')) {
      errors.push(card.id + ': compact Skill2 enum value does not match card-skill-mappings.json');
    }
    if ((card.specialSkill2 || '') !== (sourceSkill2?.sourceName || '')) {
      errors.push(card.id + ': compact Skill2 name does not match card-skill-mappings.json');
    }
    if (card.specialSkill2RuleId !== null ||
        card.specialSkill2ExecutionStatus !== ((card.specialSkill2 && card.specialSkill2 !== '없음')
          ? 'disabled-until-skill2-rule-review' : 'no-skill')) {
      errors.push(card.id + ': Skill2 has an executable rule or invalid review gate');
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
  if (card.effectExecutionStatus === 'candidate-only' && card.effect) {
    effectAudit.unexpectedExecutableEffects++;
    errors.push(card.id + ': candidate-only effect is incorrectly executable');
  }
  if (effectCandidates.length && card.effectVerificationStatus !== 'pattern_candidate') {
    errors.push(card.id + ': compact effect verification status does not match candidate file');
  }

  if (card.type === 'land') {
    landStatus[card.soulProductionStatus || 'missing'] =
      (landStatus[card.soulProductionStatus || 'missing'] || 0) + 1;
    if (card.landInstallCostKnown === true) landInstallCost.known++;
    else landInstallCost.review++;
    if (card.costMappingReview) landInstallCost.mappingReview++;
    if (card.costSemanticReview) landInstallCost.semanticReview++;
    if (card.requiredLPKnown !== true) errors.push(card.id + ': LP source value not marked known');
    if (card.soulProductionStatus === 'magicland-effect' && validation.ok) {
      errors.push(card.id + ': MagicLand incorrectly accepted as ordinary terrain');
    }
    if (card.soulProductionStatus === 'source-decoded' &&
        card.landInstallCostKnown === true && !validation.ok) {
      errors.push(card.id + ': decoded ordinary land blocked: ' + validation.reason);
    }
    if (card.landInstallCostKnown !== true && validation.ok) {
      errors.push(card.id + ': unknown land installation cost incorrectly accepted');
    }
  } else {
    costKnown[card.type] = costKnown[card.type] || { known:0, review:0, mappingReview:0, semanticReview:0 };
    if (card.costKnown === true && card.costMapped === true) {
      costKnown[card.type].known++;
      if (card.costMappingReview || card.costSemanticReview) {
        errors.push(card.id + ': reviewed cost is incorrectly marked playable');
      }
    } else {
      costKnown[card.type].review++;
      if (card.costMappingReview) costKnown[card.type].mappingReview++;
      if (card.costSemanticReview) costKnown[card.type].semanticReview++;
      if (validation.ok) errors.push(card.id + ': unresolved or review-required soul cost incorrectly accepted');
    }
  }
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
    effectAudit.spanErrors !== 0 || effectAudit.unexpectedExecutableEffects !== 0) {
  errors.push('Effect candidate audit mismatch: ' + JSON.stringify(effectAudit));
}
if (skillAudit.mappingRows < 15000 || skillAudit.manualVerifiedMappings < 1000 ||
    skillAudit.communityCandidates < 100 || skillAudit.communityRuleExecution !== 0) {
  errors.push('Special-skill mapping validation mismatch: ' + JSON.stringify(skillAudit));
}
if (errors.length) {
  console.error(JSON.stringify({errors:errors.slice(0,50),errorCount:errors.length,types,landStatus,landInstallCost,costKnown,playable,effectAudit,skillAudit},null,2));
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
  playableByType:playable,
  blockedReasons:blocked,
  effectAudit,
  skillAudit,
  skill2Audit
},null,2));
