import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), 'FadiBrowserV2-QA-'));
const profilePath = path.join(runtimeRoot, 'auth', 'profile-a');
mkdirSync(profilePath, { recursive: true });
const port = await freePort();
const config = JSON.parse(readFileSync(path.join(projectRoot, 'config', 'config.example.json'), 'utf8'));
config.runtimeRoot = runtimeRoot;
config.port = port;
config.namespace = `fadi-browser-v2-qa-${randomUUID()}`;
config.authProfiles['auth-profile-a'] = { persistent: true, mode: 'profile_bound', profilePath };
const configPath = path.join(runtimeRoot, 'config.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));

const environment = {
  ...process.env,
  FADI_BROWSER_V2_RUNTIME_ROOT: runtimeRoot,
  FADI_BROWSER_V2_CONFIG: configPath,
  FADI_BROWSER_V2_API_TOKEN: randomBytes(32).toString('hex'),
  AGENT_BROWSER_ENCRYPTION_KEY: randomBytes(32).toString('hex')
};
const broker = spawn(process.execPath, ['src/server.mjs'], {
  cwd: projectRoot,
  env: environment,
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe']
});
let brokerError = '';
broker.stderr.setEncoding('utf8');
broker.stderr.on('data', chunk => { brokerError += chunk; });

try {
  await waitForHealth(port);
  const scripts = process.argv.includes('--mcp-only') ? ['qa/mcp-smoke.mjs'] : ['qa/run-qa.mjs', 'qa/mcp-smoke.mjs'];
  for (const script of scripts) {
    const code = await runNode(script);
    if (code !== 0) {
      process.exitCode = code || 1;
      break;
    }
  }
} finally {
  await fetch(`http://127.0.0.1:${port}/v1/admin/shutdown`, {
    method: 'POST',
    headers: { authorization: `Bearer ${environment.FADI_BROWSER_V2_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'stop' })
  }).catch(() => {});
  await Promise.race([
    new Promise(resolve => broker.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 10000))
  ]);
  if (broker.exitCode === null) broker.kill();
  process.stdout.write(`${JSON.stringify({ working_tree_qa_runtime: runtimeRoot, broker_stderr: sanitize(brokerError) }, null, 2)}\n`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port: selected } = server.address();
      server.close(error => error ? reject(error) : resolve(selected));
    });
  });
}

function runNode(script) {
  const child = spawn(process.execPath, [script], {
    cwd: projectRoot,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'inherit', 'inherit']
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
}

async function waitForHealth(selectedPort) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${selectedPort}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Working-tree QA broker did not become healthy. ${sanitize(brokerError)}`);
}

function sanitize(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|key|secret|password|code)=)[^&#\s]+/gi, '$1[REDACTED]')
    .slice(0, 2000);
}
