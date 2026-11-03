#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const Schema = require('../../app/src/main/assets/game/card-schema.js');
const FM = require('../../app/src/main/assets/game/rules.js');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: node validate-app-card-pack.cjs <cards.json>');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const cards = Schema.normalizeMany(raw);
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

  const skillMappings = Array.isArray(card.specialSkillMappings) ? card.specialSkillMappings : [];
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
  if (card.type === 'unit') {
    if (card.specialSkillRuleId !== expectedSkill1RuleId) {
      errors.push(card.id + ': specialSkillRuleId does not match a Manual-verified Skill1 mapping');
    }
    if (expectedSkill1RuleId) skillAudit.manualRuleCards++;
  } else if (card.specialSkillRuleId) {
    errors.push(card.id + ': non-unit card has an executable unit special-skill rule ID');
  }

  const effectCandidates = Array.isArray(card.effectCandidates) ? card.effectCandidates : [];
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
  skillAudit
},null,2));
