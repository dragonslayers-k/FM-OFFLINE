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
const landInstallCost = { known:0, review:0 };
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

  if (card.type === 'land') {
    landStatus[card.soulProductionStatus || 'missing'] =
      (landStatus[card.soulProductionStatus || 'missing'] || 0) + 1;
    if (card.landInstallCostKnown === true) landInstallCost.known++;
    else landInstallCost.review++;
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
    costKnown[card.type] = costKnown[card.type] || { known:0, review:0 };
    if (card.costKnown === true && card.costMapped === true) costKnown[card.type].known++;
    else {
      costKnown[card.type].review++;
      if (validation.ok) errors.push(card.id + ': unresolved soul cost incorrectly accepted');
    }
  }
}
for (const [type, count] of Object.entries(EXPECTED)) {
  if (types[type] !== count) errors.push(type + ' count mismatch: ' + types[type] + ' / ' + count);
}
if (cards.length !== 15350) errors.push('Total card count mismatch: ' + cards.length);
if ((landStatus['source-decoded'] || 0) !== 239) errors.push('Expected 239 decoded standard lands');
if ((landStatus['magicland-effect'] || 0) !== 50) errors.push('Expected 50 MagicLand special-effect records');
if (landInstallCost.known !== 275 || landInstallCost.review !== 14) {
  errors.push('Land install-cost accounting mismatch: ' + JSON.stringify(landInstallCost));
}
const nonLandKnown = Object.values(costKnown).reduce((s,x) => s + x.known, 0);
const nonLandReview = Object.values(costKnown).reduce((s,x) => s + x.review, 0);
if (nonLandKnown !== 14244 || nonLandReview !== 817) {
  errors.push('Non-land cost accounting mismatch: ' + JSON.stringify(costKnown));
}
if (errors.length) {
  console.error(JSON.stringify({errors:errors.slice(0,50),errorCount:errors.length,types,landStatus,landInstallCost,costKnown,playable},null,2));
  process.exit(1);
}
console.log(JSON.stringify({
  status:'PASS',
  cards:cards.length,
  categories:types,
  nonLandCostKnown:nonLandKnown,
  nonLandCostNeedsReview:nonLandReview,
  nonLandCostsByType:costKnown,
  standardLands:landStatus['source-decoded'],
  magicLandEffectRecords:landStatus['magicland-effect'],
  landInstallCost,
  playableByType:playable,
  blockedReasons:blocked
},null,2));
