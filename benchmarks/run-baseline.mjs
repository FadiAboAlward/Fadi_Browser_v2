import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrokerApiClient } from '../src/api-client.mjs';
import { loadConfig } from '../src/config.mjs';
import { percentile } from '../src/util.mjs';

const config = loadConfig();
const token = process.env.FADI_BROWSER_V2_API_TOKEN;
if (!token) throw new Error('FADI_BROWSER_V2_API_TOKEN is required.');
const api = new BrokerApiClient(`http://${config.host}:${config.port}`, token);
const results = [];

for (const concurrency of [1, 3, 5]) {
  const leases = [];
  const create = [];
  const navigate = [];
  const snapshot = [];
  const cleanup = [];
  let failures = 0;
  const freeBefore = os.freemem();
  try {
    await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
      const start = performance.now();
      try {
        const lease = await api.acquire({ clientId: 'maintenance', taskLabel: `benchmark-${concurrency}-${index + 1}` });
        create.push(performance.now() - start);
        leases.push(lease);
      } catch (error) { failures += 1; throw error; }
    }));
    await Promise.all(leases.map(async (lease, index) => {
      let start = performance.now();
      await api.navigate({ clientId: 'maintenance', leaseToken: lease.lease_token, url: `https://example.com/#benchmark-${concurrency}-${index + 1}` });
      navigate.push(performance.now() - start);
      start = performance.now();
      await api.snapshot({ clientId: 'maintenance', leaseToken: lease.lease_token, interactive: false, compact: true, depth: 3 });
      snapshot.push(performance.now() - start);
    }));
  } catch { failures += 1; }
  await Promise.all(leases.map(async lease => {
    const start = performance.now();
    try { await api.release({ clientId: 'maintenance', leaseToken: lease.lease_token }); }
    catch { failures += 1; }
    cleanup.push(performance.now() - start);
  }));
  results.push({
    concurrency,
    samples: leases.length,
    session_creation_ms: summarize(create),
    first_navigation_ms: summarize(navigate),
    snapshot_ms: summarize(snapshot),
    queue_wait_ms: { p50: 0, p95: 0 },
    cleanup_ms: summarize(cleanup),
    memory: { free_before_bytes: freeBefore, free_after_bytes: os.freemem(), total_bytes: os.totalmem() },
    cpu: { logical_cores: os.cpus().length, broker_samples_recorded_in_telemetry: true },
    failures,
    failure_rate: concurrency ? failures / concurrency : 0
  });
}

const health = await fetch(`http://${config.host}:${config.port}/health`).then(response => response.json());
const baseline = {
  generated_at: new Date().toISOString(),
  project_version: health.project_version,
  running_commit: health.running_commit,
  engine_version: health.engine_version,
  host: { platform: os.platform(), release: os.release(), arch: os.arch(), logical_cores: os.cpus().length, total_memory_bytes: os.totalmem() },
  results
};
const deploymentsRoot = path.resolve(config.runtimeRoot, 'deployments');
const projectRoot = path.resolve(config.projectRoot);
const runningFromDeployment = projectRoot === deploymentsRoot || projectRoot.startsWith(`${deploymentsRoot}${path.sep}`);
const output = runningFromDeployment
  ? path.join(config.paths.qa, 'baseline-current.json')
  : path.join(config.projectRoot, 'benchmarks', 'baseline.json');
writeFileSync(output, JSON.stringify(baseline, null, 2));
process.stdout.write(`${JSON.stringify({ ...baseline, output }, null, 2)}\n`);
if (results.some(result => result.failures > 0)) process.exitCode = 1;

function summarize(values) {
  const rounded = values.map(value => Math.round(value * 100) / 100);
  return {
    average: rounded.length ? Math.round(rounded.reduce((sum, value) => sum + value, 0) / rounded.length * 100) / 100 : 0,
    p50: percentile(rounded, 50),
    p95: percentile(rounded, 95)
  };
}
