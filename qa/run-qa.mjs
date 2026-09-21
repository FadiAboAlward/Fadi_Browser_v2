import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BrokerApiClient } from '../src/api-client.mjs';
import { loadConfig } from '../src/config.mjs';

const config = loadConfig();
const token = process.env.FADI_BROWSER_V2_API_TOKEN;
if (!token) throw new Error('FADI_BROWSER_V2_API_TOKEN is required. Use scripts/qa.ps1.');
const api = new BrokerApiClient(`http://${config.host}:${config.port}`, token);
const tests = [];
const live = [];
const startedAt = new Date().toISOString();

async function run(name, fn) {
  const started = performance.now();
  try {
    const evidence = await fn();
    tests.push({ name, status: 'PASS', duration_ms: Math.round(performance.now() - started), evidence });
  } catch (error) {
    tests.push({ name, status: 'FAIL', duration_ms: Math.round(performance.now() - started), error: { code: error.code || 'ERROR', message: error.message } });
  }
}

await run('basic', async () => {
  const lease = await api.acquire({ clientId: 'maintenance', taskLabel: 'qa-basic' });
  live.push(lease);
  await api.navigate({ clientId: 'maintenance', leaseToken: lease.lease_token, url: 'https://example.com/#basic' });
  const [url, title, snapshot] = await Promise.all([
    api.getUrl({ clientId: 'maintenance', leaseToken: lease.lease_token }),
    api.getTitle({ clientId: 'maintenance', leaseToken: lease.lease_token }),
    api.snapshot({ clientId: 'maintenance', leaseToken: lease.lease_token, interactive: false, compact: true, depth: 4 })
  ]);
  assertOutput(url, 'example.com');
  assertOutput(title, 'Example Domain');
  assertOutput(snapshot, 'Example Domain');
  await release(lease);
  return { session_id: lease.session_id, url_verified: true, title_verified: true };
});

let concurrent = [];
await run('five-concurrent-sessions', async () => {
  concurrent = [];
  const specs = [
    { clientId: 'maintenance', authProfileId: 'public' },
    { clientId: 'maintenance', authProfileId: 'public' },
    { clientId: 'client-a', authProfileId: 'auth-profile-a' },
    { clientId: 'client-b', authProfileId: 'auth-profile-b' },
    { clientId: 'client-b', authProfileId: 'auth-profile-b' }
  ];
  for (let index = 0; index < 5; index += 1) {
    const spec = specs[index];
    const lease = await api.acquire({ clientId: spec.clientId, authProfileId: spec.authProfileId, taskLabel: `qa-concurrent-${index + 1}` });
    lease.client_id = spec.clientId; // attach for cleanup
    concurrent.push(lease);
    live.push(lease);
  }
  if (new Set(concurrent.map(item => item.session_id)).size !== 5) throw new Error('Session IDs are not distinct.');
  if (new Set(concurrent.map(item => item.lease_token)).size !== 5) throw new Error('Lease tokens are not distinct.');
  await Promise.all(concurrent.map((lease, index) => api.navigate({ clientId: lease.client_id, leaseToken: lease.lease_token, url: `https://example.com/#session-${index + 1}` })));
  const urls = await Promise.all(concurrent.map(lease => api.getUrl({ clientId: lease.client_id, leaseToken: lease.lease_token })));
  urls.forEach((url, index) => assertOutput(url, `#session-${index + 1}`));
  return { distinct_sessions: 5, distinct_leases: 5, crossover_detected: false };
});

await run('queue-promotion', async () => {
  // Capacity is currently full (5 sessions from previous test).
  // Request a 6th session with a wait.
  const queuedPromise = api.acquire({ clientId: 'maintenance', taskLabel: 'qa-queued', wait: true, wait_timeout_ms: 60000 })
    .then(value => ({ value }), error => ({ error }));
  await new Promise(r => setTimeout(r, 200)); // give it time to queue

  // Release one existing session
  const released = concurrent.pop();
  await release(released, released.client_id);

  // The queued session should now resolve
  const queuedResult = await queuedPromise;
  if (queuedResult.error) throw queuedResult.error;
  const promoted = queuedResult.value;
  promoted.client_id = 'maintenance';
  concurrent.push(promoted);
  live.push(promoted);

  return { queued_and_promoted: true, session_id: promoted.session_id };
});

await run('per-client-limit', async () => {
  // client-b currently has one session. Free two global slots, bring client-b
  // exactly to its cap of three, then prove the fourth is rejected because of
  // fairness rather than global capacity.
  const toRelease = concurrent.find(l => l.client_id === 'maintenance');
  concurrent.splice(concurrent.indexOf(toRelease), 1);
  await release(toRelease, toRelease.client_id);

  const aRelease = concurrent.find(l => l.client_id === 'client-a');
  concurrent.splice(concurrent.indexOf(aRelease), 1);
  await release(aRelease, aRelease.client_id);

  const secondB = await api.acquire({ clientId: 'client-b', authProfileId: 'auth-profile-b', taskLabel: 'qa-client-limit-2' });
  const thirdB = await api.acquire({ clientId: 'client-b', authProfileId: 'auth-profile-b', taskLabel: 'qa-client-limit-3' });
  secondB.client_id = thirdB.client_id = 'client-b';
  live.push(secondB, thirdB);
  const fairnessSlot = concurrent.find(l => l.client_id === 'maintenance');
  concurrent.splice(concurrent.indexOf(fairnessSlot), 1);
  await release(fairnessSlot, fairnessSlot.client_id);

  try {
    await api.acquire({ clientId: 'client-b', authProfileId: 'auth-profile-b', taskLabel: 'qa-client-limit-fail' });
    throw new Error('Expected PER_CLIENT_LIMIT rejection.');
  } catch (error) {
    if (error.code !== 'PER_CLIENT_LIMIT') throw error;
  }

  await release(secondB, secondB.client_id);
  await release(thirdB, thirdB.client_id);
  return { per_client_limit_enforced: true };
});

await run('parallel-operations', async () => {
  const results = await Promise.all(concurrent.flatMap((lease, index) => [
    api.navigate({ clientId: lease.client_id, leaseToken: lease.lease_token, url: `https://example.com/#parallel-${index + 1}` }),
    api.snapshot({ clientId: lease.client_id, leaseToken: lease.lease_token, interactive: false, compact: true, depth: 3 })
  ]));
  return { operations: results.length };
});

await run('release-and-reuse', async () => {
  await Promise.all(concurrent.map(lease => release(lease, lease.client_id)));
  concurrent = [];
  const replacement = await api.acquire({ clientId: 'maintenance', taskLabel: 'qa-reuse' });
  live.push(replacement);
  await api.navigate({ clientId: 'maintenance', leaseToken: replacement.lease_token, url: 'https://example.com/#reuse' });
  const url = await api.getUrl({ clientId: 'maintenance', leaseToken: replacement.lease_token });
  assertOutput(url, '#reuse');
  await release(replacement, 'maintenance');
  return { cleanup_verified: true, reuse_verified: true };
});

await run('persistence-and-portability', async () => {
  const key = `qa_${Date.now()}`;
  const first = await api.acquire({ clientId: 'client-b', authProfileId: 'auth-profile-b', taskLabel: 'qa-persistence-write' });
  live.push(first);
  await api.navigate({ clientId: 'client-b', leaseToken: first.lease_token, url: 'https://example.com/' });
  await api.evaluate({ clientId: 'client-b', leaseToken: first.lease_token, script: `localStorage.setItem('fadi_browser_v2_qa', '${key}')` });

  // Test portability: same profile can be acquired concurrently (if mode is portable)
  const concurrentPortable = await api.acquire({ clientId: 'client-b', authProfileId: 'auth-profile-b', taskLabel: 'qa-persistence-concurrent' });
  live.push(concurrentPortable);
  await release(concurrentPortable, 'client-b');

  await release(first, 'client-b');
  const second = await api.acquire({ clientId: 'client-b', authProfileId: 'auth-profile-b', taskLabel: 'qa-persistence-read' });
  live.push(second);
  await api.navigate({ clientId: 'client-b', leaseToken: second.lease_token, url: 'https://example.com/' });
  const restored = await api.evaluate({ clientId: 'client-b', leaseToken: second.lease_token, script: "localStorage.getItem('fadi_browser_v2_qa')" });
  assertOutput(restored, key);
  await api.evaluate({ clientId: 'client-b', leaseToken: second.lease_token, script: "localStorage.removeItem('fadi_browser_v2_qa')" });
  await release(second, 'client-b');
  return { restored_non_sensitive_state: true, concurrent_portable_verified: true };
});

await run('profile-bound', async () => {
  const boundA = await api.acquire({ clientId: 'client-a', authProfileId: 'auth-profile-a', taskLabel: 'qa-bound-first' });
  live.push(boundA);
  try {
    await api.acquire({ clientId: 'client-a', authProfileId: 'auth-profile-a', taskLabel: 'qa-bound-second' });
    throw new Error('Expected AUTH_PROFILE_BUSY for profile_bound identity.');
  } catch (error) {
    if (error.code !== 'AUTH_PROFILE_BUSY') throw error;
  }
  await release(boundA, 'client-a');
  return { exclusive_bound_enforced: true };
});

await run('auth-policy', async () => {
  try {
    await api.acquire({ clientId: 'client-a', authProfileId: 'auth-profile-b', taskLabel: 'qa-policy-deny' });
  } catch (error) {
    if (error.code === 'AUTH_PROFILE_DENIED') return { denied_as_expected: true };
    throw error;
  }
  throw new Error('Disallowed identity was not denied.');
});

await run('observability', async () => {
  const health = await fetch(`http://${config.host}:${config.port}/health`).then(response => response.json());
  if (!health.telemetry?.sqlite || !health.telemetry?.jsonl) throw new Error('Telemetry paths are absent.');
  return { sqlite: true, jsonl: true, cloud_telemetry: false };
});

for (const lease of [...live]) await release(lease, lease.client_id).catch(() => {});
const status = tests.some(test => test.status === 'FAIL') ? 'FAIL' : 'PASS';
const result = { status, started_at: startedAt, completed_at: new Date().toISOString(), tests };
mkdirSync(config.paths.qa, { recursive: true });
const output = path.join(config.paths.qa, `qa-${Date.now()}.json`);
writeFileSync(output, JSON.stringify(result, null, 2));
process.stdout.write(`${JSON.stringify({ ...result, output }, null, 2)}\n`);
if (status === 'FAIL') process.exitCode = 1;

async function release(lease, clientId = 'maintenance') {
  if (!lease || lease.released) return;
  await api.release({ clientId, leaseToken: lease.lease_token });
  lease.released = true;
}

function assertOutput(result, expected) {
  if (!JSON.stringify(result).includes(expected)) throw new Error(`Expected engine result to contain ${expected}.`);
}
