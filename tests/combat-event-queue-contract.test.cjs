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
  const enqueueResult = queue.enqueue(event);
  enqueueResult.snapshot.unit.name = 'enqueue-result mutation';

  const drained = queue.drain();
  assert.equal(drained[0].snapshot.unit.name, '보존');
  drained[0].snapshot.unit.name = 'drain-result mutation';
  assert.equal(event.snapshot.unit.name, '보존');
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
    ruleId:'normal_attack',
    mappingStatus:'manual_verified',
    authority:'manual',
    eventTypes:['unit_destroyed']
  };
  assert.equal(dispatcher.register(rule, event => seen.push(event.sequence)).ok, true);
  queue.enqueue(FM._test.createCombatEvent('unit_destroyed'));
  queue.enqueue(FM._test.createCombatEvent('unit_destroyed'));

  assert.deepEqual(dispatcher.dispatchPending(queue, {}), [
    {ruleId:'normal_attack',eventType:'unit_destroyed',sequence:0,result:1},
    {ruleId:'normal_attack',eventType:'unit_destroyed',sequence:1,result:2}
  ]);
  assert.deepEqual(seen, [0,1]);
  assert.equal(queue.size(), 0);
  assert.deepEqual(dispatcher.dispatchPending(queue, {}), []);
});


test('zone transfer rejects invalid zone references without mutation', () => {
  const source = [{instanceId:'a'}];
  const destination = [{instanceId:'b'}];
  assert.equal(FM._test.transferCardBetweenZones(null, destination, 'a').reason, 'invalid_zones');
  assert.equal(FM._test.transferCardBetweenZones(source, source, 'a').reason, 'invalid_zones');
  assert.deepEqual(source.map(card => card.instanceId), ['a']);
  assert.deepEqual(destination.map(card => card.instanceId), ['b']);
});

test('zone transfer finds a card by instance ID and preserves card identity', () => {
  const card = {instanceId:'unit-7', name:'검증 유닛'};
  const source = [{instanceId:'unit-6'}, card, {instanceId:'unit-8'}];
  const destination = [{instanceId:'existing'}];
  const result = FM._test.transferCardBetweenZones(source, destination, 'unit-7');

  assert.equal(result.ok, true);
  assert.equal(result.sourceIndex, 1);
  assert.equal(result.card, card);
  assert.equal(destination[1], card);
  assert.deepEqual(source.map(item => item.instanceId), ['unit-6','unit-8']);
});

test('zone transfer accepts a direct card reference and appends in order', () => {
  const first = {instanceId:'first'};
  const second = {instanceId:'second'};
  const source = [first, second];
  const destination = [{instanceId:'existing'}];
  const result = FM._test.transferCardBetweenZones(source, destination, second);

  assert.equal(result.ok, true);
  assert.equal(result.card, second);
  assert.deepEqual(source, [first]);
  assert.deepEqual(destination, [{instanceId:'existing'}, second]);
});

test('zone transfer leaves both zones unchanged when card is missing or destination is full', () => {
  const card = {instanceId:'unit-9'};
  const source = [card];
  const destination = [{instanceId:'existing'}];
  const missing = FM._test.transferCardBetweenZones(source, destination, 'not-here');
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'card_not_in_source');

  const full = FM._test.transferCardBetweenZones(source, destination, 'unit-9', {maxDestinationSize:1});
  assert.equal(full.ok, false);
  assert.equal(full.reason, 'destination_full');
  assert.deepEqual(source, [card]);
  assert.deepEqual(destination, [{instanceId:'existing'}]);
});

test('zone transfer enforces a zero-capacity destination and rejects invalid limits', () => {
  const card = {instanceId:'unit-10'};
  const source = [card];
  assert.equal(FM._test.transferCardBetweenZones(source, [], 'unit-10', {maxDestinationSize:0}).reason, 'destination_full');
  assert.equal(FM._test.transferCardBetweenZones(source, [], 'unit-10', {maxDestinationSize:-1}).reason, 'destination_full');
  assert.deepEqual(source, [card]);
});
