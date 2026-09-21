import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { buildReport } from './report.mjs';
import { safeRef } from './util.mjs';

const config = loadConfig();
const daysIndex = process.argv.indexOf('--days');
const days = daysIndex >= 0 ? Number(process.argv[daysIndex + 1]) : 7;
if (![1, 7, 14, 30].includes(days)) throw new Error('Days must be one of 1, 7, 14, or 30.');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const working = path.join(config.paths.diagnostics, `diagnostics-${stamp}`);
const zip = `${working}.zip`;
mkdirSync(working, { recursive: true });

const writeJson = (name, value) => writeFileSync(path.join(working, name), JSON.stringify(value, null, 2));
const packageJson = JSON.parse(readFileSync(path.join(config.projectRoot, 'package.json'), 'utf8'));
const running = existsSync(config.paths.runningVersion) ? JSON.parse(readFileSync(config.paths.runningVersion, 'utf8')) : {};
writeJson('versions.json', {
  project_version: packageJson.version,
  engine_version: packageJson.dependencies['agent-browser'],
  running_commit: running.running_commit || 'unknown',
  node_version: process.version,
  telemetry_schema: 1,
  config_schema: config.schemaVersion
});
writeJson('safe-config.json', {
  schema_version: config.schemaVersion,
  host: config.host,
  port: config.port,
  max_concurrent_sessions: config.maxConcurrentSessions,
  retention_days: config.retentionDays,
  client_refs: Object.keys(config.clients).map(value => safeRef(value)),
  auth_profile_refs: Object.keys(config.authProfiles).map(value => safeRef(value)),
  auth_profiles_configured: Object.keys(config.authProfiles).length,
  cloud_telemetry: false
});
writeJson('os.json', {
  platform: os.platform(),
  release: os.release(),
  arch: os.arch(),
  cpu_count: os.cpus().length,
  total_memory_bytes: os.totalmem(),
  free_memory_bytes: os.freemem(),
  uptime_seconds: os.uptime()
});
writeJson('process-status.json', {
  broker_pid: running.pid || null,
  broker_running: running.pid ? processExists(running.pid) : false,
  current_process_pid: process.pid
});
writeJson('ports.json', {
  v2: await portOpen(config.port),
  v1_observed_only: Object.fromEntries(await Promise.all([8931, 8932, 8933, 8941, 8942, 8943].map(async port => [port, await portOpen(port)])))
});
let health = { broker: 'DOWN' };
try { health = await fetch(`http://${config.host}:${config.port}/health`).then(response => response.json()); } catch {}
writeJson('health.json', health);
writeJson('aggregate-report.json', buildReport(config, days));

const db = new DatabaseSync(config.paths.sqlite, { readOnly: true });
try {
  const errors = db.prepare(`
    SELECT timestamp, broker_version, engine_version, event_type, operation,
           error_category, error_code, duration_ms, concurrency_count, origin
    FROM events WHERE success = 0 ORDER BY timestamp DESC LIMIT 200
  `).all();
  writeJson('recent-errors.json', errors);
} finally { db.close(); }

const qaFiles = existsSync(config.paths.qa) ? readdirSync(config.paths.qa).filter(name => name.endsWith('.json')).map(name => path.join(config.paths.qa, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs) : [];
if (qaFiles[0]) cpSync(qaFiles[0], path.join(working, 'latest-qa.json'));

const archive = spawnSync('tar.exe', ['-a', '-c', '-f', zip, '-C', working, '.'], { encoding: 'utf8', windowsHide: true });
if (archive.status !== 0) throw new Error(`Unable to create diagnostic archive: ${archive.stderr}`);
rmSync(working, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ created: true, path: zip, contains_auth_state: false, contains_secrets: false }, null, 2)}\n`);

function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1200);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
