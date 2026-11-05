'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FM = require('../app/src/main/assets/game/rules.js');

const SOURCE_RULE = {
  ruleId: 'skill2_tactical_initiative',
  mappingStatus: 'source_card_verified',
  authority: 'card_source',
  executionStatus: 'source-card-rule-implemented',
  sourceMatch: 'skill2',
  eventTypes: ['unit_destroyed']
};

function sourceSnapshot(overrides = {}) {
  return {
    unit: {
      instanceId: 'unit-1',
      cardId: 'card-1',
      name: '기선제압 유닛',
      skill2: '기선제압',
      specialSkill2RuleId: SOURCE_RULE.ruleId,
      specialSkill2MappingStatus: SOURCE_RULE.mappingStatus,
      specialSkill2RuleAuthority: SOURCE_RULE.authority,
      specialSkill2ExecutionStatus: SOURCE_RULE.executionStatus,
      ...overrides
    }
  };
}

test('dispatcher refuses candidate-only and mismatched authority skill rules', () => {
  const dispatcher = FM._test.createCombatEventDispatcher();
  const handler = () => true;

  assert.deepEqual(dispatcher.register({
    ...SOURCE_RULE,
    mappingStatus: 'community_documented_candidate'
  }, handler), {
    ok: false,
    reason: 'rule_not_verified_or_not_implemented'
  });

  assert.deepEqual(dispatcher.register({
    ...SOURCE_RULE,
    authority: 'community'
  }, handler), {
    ok: false,
    reason: 'rule_not_verified_or_not_implemented'
  });

  assert.deepEqual(dispatcher.register({
    ...SOURCE_RULE,
    executionStatus: 'candidate-only'
  }, handler), {
    ok: false,
    reason: 'rule_not_verified_or_not_implemented'
  });

  assert.equal(dispatcher.subscriberCount(), 0);
});

test('source-verified Skill2 dispatch requires exact rule provenance and card name', () => {
  const dispatcher = FM._test.createCombatEventDispatcher();
  const seen = [];
  assert.equal(dispatcher.register(SOURCE_RULE, event => seen.push(event)).ok, true);

  const matching = FM._test.createCombatEvent('unit_destroyed', {
    snapshot: sourceSnapshot(),
    payload: {actualDamage: 1}
  });
  const wrongRuleId = FM._test.createCombatEvent('unit_destroyed', {
    snapshot: sourceSnapshot({specialSkill2RuleId: 'skill2_devoted_defense'})
  });
  const wrongMappingStatus = FM._test.createCombatEvent('unit_destroyed', {
    snapshot: sourceSnapshot({specialSkill2MappingStatus: 'community_documented_candidate'})
  });
  const wrongAuthority = FM._test.createCombatEvent('unit_destroyed', {
    snapshot: sourceSnapshot({specialSkill2RuleAuthority: 'community'})
  });
  const wrongExecution = FM._test.createCombatEvent('unit_destroyed', {
    snapshot: sourceSnapshot({specialSkill2ExecutionStatus: 'candidate-only'})
  });
  const wrongPrintedName = FM._test.createCombatEvent('unit_destroyed', {
    snapshot: sourceSnapshot({skill2: '헌신방어'})
  });

  const results = dispatcher.dispatch([
    matching, wrongRuleId, wrongMappingStatus, wrongAuthority, wrongExecution, wrongPrintedName
  ], {});
  assert.equal(results.length, 1);
  assert.equal(seen.length, 1);
  assert.equal(results[0].ruleId, SOURCE_RULE.ruleId);
});

test('source Skill2 printed name normalization permits spacing only, not alias substitution', () => {
  const dispatcher = FM._test.createCombatEventDispatcher();
  const seen = [];
  assert.equal(dispatcher.register(SOURCE_RULE, event => seen.push(event)).ok, true);

  dispatcher.dispatch(FM._test.createCombatEvent('unit_destroyed', {
    snapshot: sourceSnapshot({skill2: '기선 제압'})
  }), {});
  dispatcher.dispatch(FM._test.createCombatEvent('unit_destroyed', {
    snapshot: sourceSnapshot({skill2: '기선제압기술'})
  }), {});

  assert.equal(seen.length, 1);
  assert.equal(seen[0].snapshot.unit.skill2, '기선 제압');
});

test('dispatcher rejects duplicate rule subscription and invalid event definitions', () => {
  const dispatcher = FM._test.createCombatEventDispatcher();
  const handler = () => true;

  assert.equal(dispatcher.register(SOURCE_RULE, handler).ok, true);
  assert.deepEqual(dispatcher.register(SOURCE_RULE, handler), {
    ok: false,
    reason: 'duplicate_rule_subscription'
  });
  assert.deepEqual(dispatcher.register({...SOURCE_RULE, ruleId: 'skill2_devoted_defense', eventTypes: []}, handler), {
    ok: false,
    reason: 'invalid_event_types'
  });
});
