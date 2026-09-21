import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LeaseBroker } from '../src/broker.mjs';
import { Telemetry } from '../src/telemetry.mjs';

class FakeEngine {
  constructor() { this.sessions = new Map(); }
  async createSession(sessionId) {
    this.sessions.set(sessionId, { url: 'about:blank', title: '' });
    return { ok: true, diagnostics: { executable: 'fake-chrome', process_id: 42, window_state: 'HIDDEN', visible: false, safe_window_id: 'pid-42', active_title: null } };
  }
  async navigate(sessionId, url) { this.sessions.get(sessionId).url = url; this.sessions.get(sessionId).title = 'Example Domain'; return { ok: true, output: { url } }; }
  async snapshot(sessionId) { return { ok: true, output: { sessionId } }; }
  async getUrl(sessionId) { return { ok: true, output: { url: this.sessions.get(sessionId).url } }; }
  async getTitle(sessionId) { return { ok: true, output: { title: this.sessions.get(sessionId).title } }; }
  async evaluate() { return { ok: true, output: { value: true } }; }
  async run(sessionId, args) { return { ok: true, output: { sessionId, args } }; }
  async closeSession(sessionId) { this.sessions.delete(sessionId); return { ok: true }; }
  async sessionInfo(sessionId) { if (!this.sessions.has(sessionId)) throw new Error('gone'); return { ok: true }; }
  async restoreWindow(sessionId) {
    if (!this.sessions.has(sessionId)) throw new Error('gone');
    return { executable: 'fake-chrome', process_id: 42, window_state: 'NORMAL', visible: true, safe_window_id: 'pid-42', active_title: null };
  }
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fadi-browser-v2-test-'));
  const paths = Object.fromEntries(['data', 'logs', 'state', 'auth', 'diagnostics', 'qa', 'deployments'].map(name => [name, path.join(root, name)]));
  for (const value of Object.values(paths)) mkdirSync(value, { recursive: true });
  paths.sqlite = path.join(paths.data, 'telemetry.sqlite');
  paths.jsonl = path.join(paths.logs, 'events.jsonl');
  const config = {
    runtimeRoot: root,
    projectRoot: process.cwd(),
    maxConcurrentSessions: 5,
    maxSessionsPerClient: 5,
    queueMaxDepth: 10,
    queueWaitTimeoutMs: 5000,
    leaseTtlMs: 300000,
    recoveryWindowMs: 120000,
    retentionDays: 30,
    namespace: 'test',
    paths,
    clients: {
      'client-a': { defaultAuthProfile: 'auth-profile-a', allowedAuthProfiles: ['auth-profile-a'] },
      'client-b': { defaultAuthProfile: 'auth-profile-b', allowedAuthProfiles: ['auth-profile-b'] },
      maintenance: { defaultAuthProfile: 'public', allowedAuthProfiles: ['public', 'auth-profile-a', 'auth-profile-b', 'bound-profile'] }
    },
    authProfiles: {
      public: { persistent: false, mode: 'portable' },
      'auth-profile-a': { persistent: true, mode: 'portable' },
      'auth-profile-b': { persistent: true, mode: 'portable' },
      'bound-profile': { persistent: true, mode: 'profile_bound' }
    }
  };
  const telemetry = new Telemetry(config, { brokerVersion: 'test', engineVersion: 'test' });
  const engine = new FakeEngine();
  const broker = new LeaseBroker(config, telemetry, engine, { brokerVersion: 'test', engineVersion: 'test' });
  return { root, config, telemetry, engine, broker };
}

test('acquire_returns_single_active_lease', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    assert.equal(lease.status, 'ACTIVE');
    assert.equal(f.broker.activeCount(), 1);
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('concurrent_sessions_remain_isolated', async () => {
  const f = fixture();
  try {
    const leases = await Promise.all(Array.from({ length: 5 }, (_, index) => f.broker.acquire({ clientId: 'maintenance', taskLabel: `task-${index}` })));
    assert.equal(new Set(leases.map(item => item.session_id)).size, 5);
    assert.equal(new Set(leases.map(item => item.lease_token)).size, 5);
    await assert.rejects(() => f.broker.acquire({ clientId: 'maintenance' }), error => ['CAPACITY_EXHAUSTED', 'PER_CLIENT_LIMIT'].includes(error.code));
    await Promise.all(leases.map(item => f.broker.release({ clientId: 'maintenance', leaseToken: item.lease_token })));
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('other_session_cannot_hijack_lease', async () => {
  const f = fixture();
  try {
    await assert.rejects(() => f.broker.acquire({ clientId: 'client-a', authProfileId: 'auth-profile-b' }), error => error.code === 'AUTH_PROFILE_DENIED');
    const lease = await f.broker.acquire({ clientId: 'client-a' });
    await assert.rejects(() => f.broker.getUrl({ clientId: 'client-b', leaseToken: lease.lease_token }), error => error.code === 'LEASE_OWNER_MISMATCH');
    await f.broker.release({ clientId: 'client-a', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('release_without_unnecessary_prompt', async () => {
  const f = fixture();
  try {
    const first = await f.broker.acquire({ clientId: 'maintenance' });
    await f.broker.release({ clientId: 'maintenance', leaseToken: first.lease_token });
    const second = await f.broker.acquire({ clientId: 'maintenance' });
    assert.notEqual(first.session_id, second.session_id);
    await f.broker.release({ clientId: 'maintenance', leaseToken: second.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('broker_restart_recover_validates_ingress', async () => {
  const f = fixture();
  const lease = await f.broker.acquire({ clientId: 'maintenance' });
  await f.broker.shutdown({ preserveRecoverable: true });
  f.telemetry.close();
  const telemetry2 = new Telemetry(f.config, { brokerVersion: 'test', engineVersion: 'test' });
  const broker2 = new LeaseBroker(f.config, telemetry2, f.engine, { brokerVersion: 'test', engineVersion: 'test' });
  try {
    await assert.rejects(() => broker2.recover({ clientId: 'client-a', leaseToken: lease.lease_token }), error => error.code === 'LEASE_OWNER_MISMATCH');
    const recovered = await broker2.recover({ clientId: 'maintenance', leaseToken: lease.lease_token });
    assert.equal(recovered.status, 'ACTIVE');
    await broker2.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await broker2.shutdown({ preserveRecoverable: true });
    telemetry2.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('busy_capacity_exposes_actionable_queue', async () => {
  const f = fixture();
  try {
    // Fill capacity
    const leases = await Promise.all(Array.from({ length: 5 }, (_, i) => f.broker.acquire({ clientId: 'maintenance', taskLabel: `fill-${i}` })));
    assert.equal(f.broker.activeCount(), 5);

    // 6th request queues with explicit wait
    const queued = f.broker.acquire({ clientId: 'maintenance', waitTimeoutMs: 5000 });
    // Give the enqueue a tick to register
    await new Promise(r => setTimeout(r, 50));
    assert.equal(f.broker.queue.length, 1);

    // Release one slot — queued request should be promoted
    await f.broker.release({ clientId: 'maintenance', leaseToken: leases[0].lease_token });
    const promoted = await queued;
    assert.equal(promoted.status, 'ACTIVE');
    assert.ok(promoted.queue_wait_ms > 0);

    // Clean up
    for (let i = 1; i < 5; i++) await f.broker.release({ clientId: 'maintenance', leaseToken: leases[i].lease_token });
    await f.broker.release({ clientId: 'maintenance', leaseToken: promoted.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('queue rejects immediately without waitTimeoutMs', async () => {
  const f = fixture();
  try {
    const leases = await Promise.all(Array.from({ length: 5 }, (_, i) => f.broker.acquire({ clientId: 'maintenance' })));
    await assert.rejects(
      () => f.broker.acquire({ clientId: 'maintenance' }),
      error => ['CAPACITY_EXHAUSTED', 'PER_CLIENT_LIMIT'].includes(error.code)
    );
    await Promise.all(leases.map(l => f.broker.release({ clientId: 'maintenance', leaseToken: l.lease_token })));
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('queue_timeout_is_unambiguous', async () => {
  const f = fixture();
  f.config.queueWaitTimeoutMs = 200;
  const broker2 = new LeaseBroker(f.config, f.telemetry, f.engine, { brokerVersion: 'test', engineVersion: 'test' });
  try {
    const leases = await Promise.all(Array.from({ length: 5 }, () => broker2.acquire({ clientId: 'maintenance' })));
    await assert.rejects(
      () => broker2.acquire({ clientId: 'maintenance', waitTimeoutMs: 200 }),
      error => error.code === 'QUEUE_TIMEOUT'
    );
    await Promise.all(leases.map(l => broker2.release({ clientId: 'maintenance', leaseToken: l.lease_token })));
  } finally {
    await broker2.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('per-client concurrency cap rejects at limit', async () => {
  const f = fixture();
  f.config.maxSessionsPerClient = 2;
  const broker2 = new LeaseBroker(f.config, f.telemetry, f.engine, { brokerVersion: 'test', engineVersion: 'test' });
  try {
    const lease1 = await broker2.acquire({ clientId: 'maintenance' });
    const lease2 = await broker2.acquire({ clientId: 'maintenance' });
    await assert.rejects(
      () => broker2.acquire({ clientId: 'maintenance' }),
      error => error.code === 'PER_CLIENT_LIMIT'
    );
    await broker2.release({ clientId: 'maintenance', leaseToken: lease1.lease_token });
    await broker2.release({ clientId: 'maintenance', leaseToken: lease2.lease_token });
  } finally {
    await broker2.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('profile-bound identity rejects concurrent use', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance', authProfileId: 'bound-profile' });
    await assert.rejects(
      () => f.broker.acquire({ clientId: 'maintenance', authProfileId: 'bound-profile' }),
      error => error.code === 'AUTH_PROFILE_BUSY'
    );
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
    // After release, same profile can be acquired again
    const lease2 = await f.broker.acquire({ clientId: 'maintenance', authProfileId: 'bound-profile' });
    assert.equal(lease2.status, 'ACTIVE');
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease2.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('portable identity allows concurrent use', async () => {
  const f = fixture();
  try {
    const lease1 = await f.broker.acquire({ clientId: 'maintenance', authProfileId: 'auth-profile-a' });
    const lease2 = await f.broker.acquire({ clientId: 'maintenance', authProfileId: 'auth-profile-a' });
    assert.notEqual(lease1.session_id, lease2.session_id);
    assert.equal(lease1.auth_profile_id, 'auth-profile-a');
    assert.equal(lease2.auth_profile_id, 'auth-profile-a');
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease1.lease_token });
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease2.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('status includes queue depth and auth mode', async () => {
  const f = fixture();
  try {
    const status = f.broker.status();
    assert.equal(status.broker, 'HEALTHY');
    assert.equal(status.sessions_queued, 0);
    assert.equal(status.concurrency_limit, 5);
    assert.ok(status.auth_profiles['bound-profile']);
    assert.equal(status.auth_profiles['bound-profile'].auth_mode, 'profile_bound');
    assert.equal(status.auth_profiles['bound-profile'].concurrent_allowed, false);
    assert.equal(status.auth_profiles.public.auth_mode, 'portable');
    assert.equal(status.auth_profiles.public.concurrent_allowed, true);
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('stale_lease_reap_is_safe', async () => {
  const f = fixture();
  f.config.leaseTtlMs = 1;
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    await new Promise(resolve => setTimeout(resolve, 5));
    await f.broker.reapStale();
    assert.equal(f.broker.activeCount(), 0);
    await assert.rejects(
      () => f.broker.getUrl({ clientId: 'maintenance', leaseToken: lease.lease_token }),
      error => error.code === 'INVALID_LEASE_TOKEN'
    );
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('interactive_window_restore_preserves_profile', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    const status = f.broker.status({ clientId: 'maintenance', leaseToken: lease.lease_token });
    assert.equal(status.browser.safe_window_id, 'pid-42');
    assert.equal(status.browser.window_state, 'HIDDEN');
    const restored = await f.broker.restoreWindow({ clientId: 'maintenance', leaseToken: lease.lease_token });
    assert.equal(restored.window_state, 'NORMAL');
    assert.equal(restored.safe_window_id, status.browser.safe_window_id);
    assert.equal(f.engine.sessions.size, 1);
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
