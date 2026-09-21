import assert from 'node:assert/strict';
import test from 'node:test';
import { LeaseQueue } from '../src/queue.mjs';

class FakeTelemetry {
  constructor() { this.events = []; }
  event(name, data) { this.events.push({ name, data }); }
}

function makeQueue(overrides = {}) {
  const config = { queueMaxDepth: 3, queueWaitTimeoutMs: 1000, ...overrides };
  const telemetry = new FakeTelemetry();
  const queue = new LeaseQueue(config, telemetry);
  return { queue, telemetry, config };
}

test('fifo_queue_never_steals_live_lease', async () => {
  const { queue, telemetry } = makeQueue();
  const results = [];

  // Enqueue two entries — they will wait until dequeued
  const q1 = queue.enqueue({ clientId: 'a', authProfileId: 'x' });
  const q2 = queue.enqueue({ clientId: 'b', authProfileId: 'y' });
  const p1 = q1.then(() => results.push('a'));
  const p2 = q2.then(() => results.push('b'));

  assert.equal(queue.length, 2);

  // Dequeue first-in
  const first = queue.takeHead();
  queue.resolve(first);
  await p1;
  assert.deepEqual(results, ['a']);

  // Dequeue second
  const second = queue.takeHead();
  queue.resolve(second);
  await p2;
  assert.deepEqual(results, ['a', 'b']);

  assert.equal(queue.length, 0);

  // Telemetry check
  const entered = telemetry.events.filter(e => e.name === 'queue_joined');
  const promoted = telemetry.events.filter(e => e.name === 'queue_promoted');
  assert.equal(entered.length, 2);
  assert.equal(promoted.length, 2);
});

test('strict FIFO never skips an ineligible head entry', async () => {
  const { queue } = makeQueue();
  const results = [];

  const q1 = queue.enqueue({ clientId: 'a', authProfileId: 'x' });
  const q2 = queue.enqueue({ clientId: 'b', authProfileId: 'y' });
  const p1 = q1.then(() => results.push('a')).catch(() => {});
  const p2 = q2.then(() => results.push('b')).catch(() => {});

  assert.equal(queue.length, 2);

  // The second entry must not bypass the first even if it matches.
  const skipped = queue.takeHead(e => e.clientId === 'b');
  assert.equal(skipped, null);
  assert.deepEqual(results, []);
  assert.equal(queue.length, 2);

  const first = queue.takeHead(e => e.clientId === 'a');
  queue.resolve(first);
  await p1;
  const second = queue.takeHead(e => e.clientId === 'b');
  queue.resolve(second);
  await p2;
  assert.deepEqual(results, ['a', 'b']);
});

test('queue rejects when full', async () => {
  const { queue } = makeQueue({ queueMaxDepth: 2 });

  // Fill queue (don't await — they're waiting for dequeue)
  const p1 = queue.enqueue({ clientId: 'a', authProfileId: 'x' }).catch(() => {});
  const p2 = queue.enqueue({ clientId: 'b', authProfileId: 'y' }).catch(() => {});

  assert.throws(
    () => queue.enqueue({ clientId: 'c', authProfileId: 'z' }),
    error => error.code === 'QUEUE_FULL'
  );

  // Clean up
  queue.drain();
  await Promise.all([p1, p2]);
});

test('queue entry times out', async () => {
  const { queue, telemetry } = makeQueue({ queueWaitTimeoutMs: 100 });

  await assert.rejects(
    () => queue.enqueue({ clientId: 'a', authProfileId: 'x' }),
    error => error.code === 'QUEUE_TIMEOUT'
  );

  assert.equal(queue.length, 0);
  const timeouts = telemetry.events.filter(e => e.name === 'queue_timeout');
  assert.equal(timeouts.length, 1);
});

test('cancel removes a specific entry', async () => {
  const { queue, telemetry } = makeQueue();

  // Get queue entry ID from telemetry
  const p = queue.enqueue({ clientId: 'a', authProfileId: 'x' });
  const entryEvent = telemetry.events.find(e => e.name === 'queue_joined');
  const queueId = p.id;

  assert.equal(queue.length, 1);
  queue.cancel(queueId);
  assert.equal(queue.length, 0);

  await assert.rejects(() => p, error => error.code === 'QUEUE_CANCELLED');
});

test('client cancellation aborts a bounded queue wait', async () => {
  const { queue } = makeQueue();
  const controller = new AbortController();
  const pending = queue.enqueue({ clientId: 'a', authProfileId: 'x', signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, error => error.code === 'QUEUE_CANCELLED');
  assert.equal(queue.length, 0);
});

test('drain cancels all entries', async () => {
  const { queue } = makeQueue();
  const errors = [];

  queue.enqueue({ clientId: 'a', authProfileId: 'x' }).catch(e => errors.push(e));
  queue.enqueue({ clientId: 'b', authProfileId: 'y' }).catch(e => errors.push(e));

  assert.equal(queue.length, 2);
  queue.drain();
  assert.equal(queue.length, 0);

  await new Promise(r => setTimeout(r, 20));
  assert.equal(errors.length, 2);
  assert.ok(errors.every(e => e.code === 'QUEUE_CANCELLED'));
});
