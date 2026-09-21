import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LeaseBroker } from '../src/broker.mjs';
import { Telemetry } from '../src/telemetry.mjs';

class FakeEngine {
  constructor() { this.sessions = new Map(); }
  async createSession(sessionId) { this.sessions.set(sessionId, { url: 'about:blank', title: '' }); return { ok: true }; }
  async navigate(sessionId, url) { this.sessions.get(sessionId).url = url; this.sessions.get(sessionId).title = 'Example Domain'; return { ok: true, output: { url } }; }
  async snapshot(sessionId) { return { ok: true, output: { sessionId } }; }
  async getUrl(sessionId) { return { ok: true, output: { url: this.sessions.get(sessionId).url } }; }
  async getTitle(sessionId) { return { ok: true, output: { title: this.sessions.get(sessionId).title } }; }
  async evaluate() { return { ok: true, output: { value: true } }; }
  async run(sessionId, args) { return { ok: true, output: { sessionId, args } }; }
  async closeSession(sessionId) { this.sessions.delete(sessionId); return { ok: true }; }
  async sessionInfo(sessionId) { if (!this.sessions.has(sessionId)) throw new Error('gone'); return { ok: true }; }
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
    leaseTtlMs: 300000,
    recoveryWindowMs: 120000,
    retentionDays: 30,
    namespace: 'test',
    paths,
    clients: {
      'client-a': { defaultAuthProfile: 'auth-profile-a', allowedAuthProfiles: ['auth-profile-a'] },
      'client-b': { defaultAuthProfile: 'auth-profile-b', allowedAuthProfiles: ['auth-profile-b'] },
      maintenance: { defaultAuthProfile: 'public', allowedAuthProfiles: ['public', 'auth-profile-a', 'auth-profile-b'] }
    },
    authProfiles: {
      public: { persistent: false },
      'auth-profile-a': { persistent: true },
      'auth-profile-b': { persistent: true }
    }
  };
  const telemetry = new Telemetry(config, { brokerVersion: 'test', engineVersion: 'test' });
  const engine = new FakeEngine();
  const broker = new LeaseBroker(config, telemetry, engine, { brokerVersion: 'test', engineVersion: 'test' });
  return { root, config, telemetry, engine, broker };
}

test('allocates five isolated sessions and rejects the sixth', async () => {
  const f = fixture();
  try {
    const leases = await Promise.all(Array.from({ length: 5 }, (_, index) => f.broker.acquire({ clientId: 'maintenance', taskLabel: `task-${index}` })));
    assert.equal(new Set(leases.map(item => item.session_id)).size, 5);
    assert.equal(new Set(leases.map(item => item.lease_token)).size, 5);
    await assert.rejects(() => f.broker.acquire({ clientId: 'maintenance' }), error => error.code === 'CAPACITY_EXHAUSTED');
    await Promise.all(leases.map(item => f.broker.release({ clientId: 'maintenance', leaseToken: item.lease_token })));
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('fails closed on client mismatch and disallowed identity', async () => {
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

test('release frees capacity for reuse', async () => {
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

test('restart recovery requires the original token and client', async () => {
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
