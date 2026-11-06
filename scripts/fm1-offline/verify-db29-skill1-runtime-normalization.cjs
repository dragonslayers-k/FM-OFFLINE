#!/usr/bin/env node
'use strict';

// Validate the exact FMCardSchema normalizer used by app.js against cards
// produced from the immutable DB29 release. This complements the Android
// importer smoke test: it checks real source-card metadata, not synthetic fixtures.
const fs = require('node:fs');
const path = require('node:path');
const FMCardSchema = require('../../app/src/main/assets/game/card-schema.js');

const EXPECTED = {
  '10020341112': { name: '은룡의검', ruleId: 'normal_attack', sourceLabel: '일반공격' },
  '10091525214': { name: '블랙유니콘', ruleId: 'piercing_attack', sourceLabel: '관통공격' },
  '10091525190': { name: '이블크로우', ruleId: 'weaken_attack', sourceLabel: '약화공격' },
  '10010624589': { name: '파프니르', ruleId: 'petrify_attack', sourceLabel: '석화공격' },
  '10010624551': { name: '해적전투원', ruleId: 'shield_break', sourceLabel: '방패파괴' },
  '10010624563': { name: '리듬포이', ruleId: 'defense_convert', sourceLabel: null },
};

function fail(message) {
  throw new Error('DB29 Skill1 runtime-normalization validation FAILED: ' + message);
}

function main() {
  const args = process.argv.slice(2);
  const get = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  const cardsPath = get('--cards-json');
  const releaseTag = get('--release-tag');
  if (!cardsPath || !releaseTag) fail('required --cards-json and --release-tag arguments are missing');
  if (releaseTag !== 'fm1-carddb-29') fail('expected immutable release fm1-carddb-29, got ' + releaseTag);
  if (!fs.existsSync(cardsPath)) fail('generated cards.json is unavailable: ' + cardsPath);

  const rawCards = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));
  if (!Array.isArray(rawCards) || rawCards.length !== 15350) {
    fail('expected exactly 15,350 generated source cards');
  }

  const seen = new Set();
  const selected = new Map();
  const pageSize = 250;
  for (let offset = 0; offset < rawCards.length; offset += pageSize) {
    const page = rawCards.slice(offset, offset + pageSize);
    const normalized = FMCardSchema.normalizeMany(page);
    for (let i = 0; i < normalized.length; i++) {
      const card = normalized[i];
      const raw = page[i];
      const id = String(card.id);
      if (seen.has(id)) fail('duplicate normalized card ID ' + id);
      seen.add(id);
      if (Object.prototype.hasOwnProperty.call(EXPECTED, id)) selected.set(id, { raw, card });
    }
  }
  if (seen.size !== 15350) fail('normalizer returned ' + seen.size + ' unique cards, expected 15,350');

  const checks = [];
  for (const [id, expected] of Object.entries(EXPECTED)) {
    const pair = selected.get(id);
    if (!pair) fail(id + ': representative card is missing after normalization');
    const { raw, card } = pair;
    if (raw.name !== expected.name || card.name !== expected.name) {
      fail(id + ': source/runtime name mismatch (' + raw.name + ' / ' + card.name + ')');
    }
    if (raw.sourceCardUrl !== 'https://fmlunatic.com/card/' + id ||
        card.sourceCardUrl !== raw.sourceCardUrl) {
      fail(id + ': source card URL was not preserved by the runtime normalizer');
    }
    const sourceFields = raw.sourceFields || {};
    if (!card.sourceFields || card.sourceFields.Skill1 !== sourceFields.Skill1 ||
        card.sourceFields.Skill2 !== sourceFields.Skill2) {
      fail(id + ': raw Skill1/Skill2 source fields were changed or conflated');
    }
    if (card.specialSkill1EnumValue !== raw.specialSkill1EnumValue ||
        card.specialSkill2EnumValue !== raw.specialSkill2EnumValue) {
      fail(id + ': separate Skill1/Skill2 enum values were not preserved');
    }
    if (card.specialSkill1 !== raw.specialSkill1 || card.specialSkill2 !== raw.specialSkill2) {
      fail(id + ': separate Skill1/Skill2 labels were not preserved');
    }
    if (expected.sourceLabel && raw.specialSkill1 !== expected.sourceLabel) {
      fail(id + ': source Skill1 label ' + raw.specialSkill1 + ' != ' + expected.sourceLabel);
    }
    if (card.type === 'unit') {
      if (raw.specialSkillMappingStatus !== 'manual_verified' ||
          raw.specialSkillRuleAuthority !== 'manual' ||
          raw.specialSkillRuleId !== expected.ruleId) {
        fail(id + ': source pack is not the expected Manual-verified rule mapping');
      }
      if (card.specialSkillMappingStatus !== 'manual_verified' ||
          card.specialSkillRuleAuthority !== 'manual' ||
          card.specialSkillRuleId !== expected.ruleId ||
          card.specialSkillExecutionStatus !== 'manual-rule-catalogue-mapped') {
        fail(id + ': runtime normalizer did not retain the Manual Skill1 metadata');
      }
    } else {
      if (raw.specialSkillExecutionStatus !== 'metadata-only' ||
          card.specialSkillExecutionStatus !== 'metadata-only' ||
          card.specialSkillRuleId != null) {
        fail(id + ': non-unit Skill1 leaked into unit runtime metadata');
      }
    }
    checks.push({
      cardId: id,
      name: card.name,
      type: card.type,
      skill1: card.specialSkill1,
      skill2: card.specialSkill2,
      ruleId: card.specialSkillRuleId || null,
      executionStatus: card.specialSkillExecutionStatus
    });
  }

  process.stdout.write(JSON.stringify({
    status: 'PASS',
    sourceRelease: releaseTag,
    normalizedCardCount: seen.size,
    pageSize,
    representativeCardsChecked: checks.length,
    checks
  }, null, 2) + '\\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(String(error && error.stack || error) + '\\n');
  process.exitCode = 1;
}
