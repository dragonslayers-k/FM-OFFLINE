'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FM = require('../app/src/main/assets/game/rules.js');

test('combat event snapshots are detached from mutable source objects', () => {
  const source = {instanceId:'src-1', cardId:'card-1'};
  const snapshot = {unit:{name:'원본', stats:{hp:4}}};
  const payload = {damage:2, tags:['combat']};
  const event = FM._test.createCombatEvent('unit_destroyed', {
    source, snapshot, payload, ownerId:7, fieldIndex:2
  });
  source.instanceId = 'changed';
  snapshot.unit.stats.hp = 99;
  payload.tags.push('changed');

  assert.equal(event.sourceInstanceId, 'src-1');
  assert.equal(event.snapshot.unit.stats.hp, 4);
  assert.deepEqual(event.payload.tags, ['combat']);
  assert.equal(event.ownerId, '7');
  assert.equal(event.fieldIndex, 2);
});

test('combat event queue assigns monotonic sequence numbers and drains FIFO', () => {
  const queue = FM._test.createCombatEventQueue();
  const first = FM._test.createCombatEvent('unit_summoned', {ownerId:'p'});
  const second = FM._test.createCombatEvent('item_equipped', {ownerId:'p'});
  assert.equal(queue.size(), 0);

  const queuedFirst = queue.enqueue(first);
  const queuedSecond = queue.enqueue(second);
  assert.equal(queuedFirst.sequence, 0);
  assert.equal(queuedSecond.sequence, 1);
  assert.equal(queue.size(), 2);
  assert.deepEqual(queue.drain().map(event => event.type), ['unit_summoned','item_equipped']);
  assert.equal(queue.size(), 0);
  assert.equal(queue.drain().length, 0);
});

test('enqueued event is isolated from caller mutation and drain mutation', () => {
  const queue = FM._test.createCombatEventQueue();
  const event = FM._test.createCombatEvent('unit_destroyed', {
    snapshot:{unit:{name:'보존'}}, payload:{equipmentCount:1}
  });
  queue.enqueue(event);
  event.snapshot.unit.name = 'caller mutation';

  const drained = queue.drain();
  assert.equal(drained[0].snapshot.unit.name, '보존');
  drained[0].snapshot.unit.name = 'drain mutation';
  queue.enqueue(FM._test.createCombatEvent('unit_attack_resolved'));
  assert.equal(queue.drain()[0].sequence, 1);
});

test('combat event creation rejects missing event type and queue rejects malformed records', () => {
  assert.throws(() => FM._test.createCombatEvent('  '), /type is required/i);
  const queue = FM._test.createCombatEventQueue();
  assert.throws(() => queue.enqueue(null), /valid combat event/i);
  assert.throws(() => queue.enqueue({type:''}), /valid combat event/i);
});

test('combat event dispatcher drains each queued event once and preserves sequence order', () => {
  const queue = FM._test.createCombatEventQueue();
  const dispatcher = FM._test.createCombatEventDispatcher();
  const seen = [];
  const rule = {
    ruleId:'skill1_test_event_probe',
    mappingStatus:'manual_verified',
    authority:'manual',
    eventTypes:['unit_destroyed']
  };
  assert.equal(dispatcher.register(rule, event => seen.push(event.sequence)).ok, true);
  queue.enqueue(FM._test.createCombatEvent('unit_destroyed'));
  queue.enqueue(FM._test.createCombatEvent('unit_destroyed'));

  assert.deepEqual(dispatcher.dispatchPending(queue, {}), [
    {ruleId:'skill1_test_event_probe',eventType:'unit_destroyed',sequence:0,result:1},
    {ruleId:'skill1_test_event_probe',eventType:'unit_destroyed',sequence:1,result:2}
  ]);
  assert.deepEqual(seen, [0,1]);
  assert.equal(queue.size(), 0);
  assert.deepEqual(dispatcher.dispatchPending(queue, {}), []);
});
