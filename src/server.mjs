import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localhostHostValidation, localhostOriginValidation, NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { loadConfig } from './config.mjs';
import { AgentBrowserEngine } from './engine.mjs';
import { LeaseBroker } from './broker.mjs';
import { BrokerError, asBrokerError } from './errors.mjs';
import { createBrokerMcpServer } from './mcp.mjs';
import { Telemetry, telemetryPaths } from './telemetry.mjs';
import { nowIso } from './util.mjs';

const config = loadConfig();
const packageJson = JSON.parse(readFileSync(path.join(config.projectRoot, 'package.json'), 'utf8'));
const recentCrash = existsSync(config.paths.runningMarker);
const versions = {
  brokerVersion: packageJson.version,
  engineVersion: packageJson.dependencies['agent-browser'],
  runningCommit: process.env.FADI_BROWSER_V2_RUNNING_COMMIT || 'working-tree',
  sourceDirty: process.env.FADI_BROWSER_V2_SOURCE_DIRTY === 'true',
  recentCrash
};
const apiToken = process.env.FADI_BROWSER_V2_API_TOKEN;
if (!apiToken || apiToken.length < 32) throw new BrokerError('CONFIG', 'API_TOKEN_MISSING', 'FADI_BROWSER_V2_API_TOKEN is required.', undefined, 500);
if (!process.env.AGENT_BROWSER_ENCRYPTION_KEY || !/^[a-fA-F0-9]{64}$/.test(process.env.AGENT_BROWSER_ENCRYPTION_KEY)) {
  throw new BrokerError('CONFIG', 'ENCRYPTION_KEY_MISSING', 'A 64-character AGENT_BROWSER_ENCRYPTION_KEY is required.', undefined, 500);
}

const telemetry = new Telemetry(config, versions);
const engine = new AgentBrowserEngine(config);
const broker = new LeaseBroker(config, telemetry, engine, versions);
const mcpSessions = new Map();
const goilotTaskContexts = new Map();
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

let shuttingDown = false;
const httpServer = createServer(async (req, res) => {
  try {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ...broker.status(), telemetry: telemetryPaths(config) });
    }
    if (url.pathname.startsWith('/mcp')) {
      requireAuthorization(req);
      const parts = url.pathname.split('/');
      const preboundClientId = parts.length > 2 && parts[2] ? parts[2] : null;
      await handleMcpRequest(req, res, preboundClientId);
      return;
    }
    if (req.method !== 'POST') return sendJson(res, 404, { error: { category: 'MCP_TRANSPORT', code: 'NOT_FOUND', message: 'Route not found.' } });
    requireAuthorization(req);
    const body = await readJson(req);
    const result = await routeApi(url.pathname, body);
    sendJson(res, 200, result);
  } catch (error) {
    const failure = asBrokerError(error, 'BROKER', 'HTTP_HANDLER_FAILED');
    sendJson(res, failure.httpStatus || 500, failure.toJSON());
  }
});

async function routeApi(route, body) {
  switch (route) {
    case '/v1/acquire': return broker.acquire({ clientId: body.client_id, authProfileId: body.auth_profile_id, poolId: body.pool_id, taskLabel: body.task_label, waitTimeoutMs: body.wait_timeout_ms });
    case '/v1/status': return broker.status({ clientId: body.client_id, leaseToken: body.lease_token });
    case '/v1/recover': return broker.recover({ clientId: body.client_id, leaseToken: body.lease_token });
    case '/v1/release': return broker.release({ clientId: body.client_id, leaseToken: body.lease_token });
    case '/v1/queue/cancel': return broker.cancelQueue({ clientId: body.client_id, queueId: body.queue_id });
    case '/v1/navigate': return broker.navigate({ clientId: body.client_id, leaseToken: body.lease_token, url: body.url });
    case '/v1/snapshot': return broker.snapshot({ clientId: body.client_id, leaseToken: body.lease_token, interactive: body.interactive, compact: body.compact, depth: body.depth });
    case '/v1/get-url': return broker.getUrl({ clientId: body.client_id, leaseToken: body.lease_token });
    case '/v1/get-title': return broker.getTitle({ clientId: body.client_id, leaseToken: body.lease_token });
    case '/v1/evaluate': return broker.evaluate({ clientId: body.client_id, leaseToken: body.lease_token, script: body.script });
    case '/v1/command': return broker.command({ clientId: body.client_id, leaseToken: body.lease_token, command: body.command, args: body.args || [] });
    case '/v1/restore-window': return broker.restoreWindow({ clientId: body.client_id, leaseToken: body.lease_token });
    case '/v1/admin/reap': await broker.reapStale(); return broker.status();
    case '/v1/admin/shutdown': {
      if (shuttingDown) return { status: 'SHUTTING_DOWN' };
      shuttingDown = true;
      const preserveRecoverable = body.mode === 'restart';
      setTimeout(() => void shutdown(preserveRecoverable), 25).unref();
      return { status: 'SHUTTING_DOWN', preserve_recoverable: preserveRecoverable };
    }
    default: throw new BrokerError('MCP_TRANSPORT', 'NOT_FOUND', 'Route not found.', undefined, 404);
  }
}

async function handleMcpRequest(req, res, preboundClientId = null) {
  // ChatGPT's tunnel creates a fresh MCP transport session for each tool call.
  // Its stable, ingress-provided chat identity is the task boundary for Goilot only.
  const taskKey = goilotTaskKey(req, preboundClientId);
  const requestedSessionId = String(req.headers['mcp-session-id'] || '');
  if (requestedSessionId) {
    const existing = mcpSessions.get(requestedSessionId);
    if (!existing) return sendJson(res, 404, { error: { category: 'MCP_TRANSPORT', code: 'MCP_SESSION_NOT_FOUND', message: 'MCP session is unknown or closed.' } });
    if (existing.preboundClientId !== preboundClientId || existing.taskKey !== taskKey) {
      return sendJson(res, 404, { error: { category: 'MCP_TRANSPORT', code: 'MCP_SESSION_NOT_FOUND', message: 'MCP session is unknown or closed.' } });
    }
    await existing.transport.handleRequest(req, res);
    return;
  }
  if (req.method !== 'POST') return sendJson(res, 400, { error: { category: 'MCP_TRANSPORT', code: 'MCP_SESSION_REQUIRED', message: 'Initialize an MCP session first.' } });

  let taskContext = null;
  if (taskKey) {
    const now = Date.now();
    for (const [key, entry] of goilotTaskContexts) {
      if (now - entry.lastSeen > config.leaseTtlMs + config.recoveryWindowMs + 60000) goilotTaskContexts.delete(key);
    }
    let entry = goilotTaskContexts.get(taskKey);
    if (!entry) {
      entry = { context: { clientId: null, leaseToken: null }, lastSeen: now };
      goilotTaskContexts.set(taskKey, entry);
    }
    entry.lastSeen = now;
    taskContext = entry.context;
  }
  const server = createBrokerMcpServer(broker, versions.brokerVersion, preboundClientId, taskContext);
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: sessionId => mcpSessions.set(sessionId, { server, transport, preboundClientId, taskKey })
  });
  transport.onerror = error => telemetry.event('tool_failed', {
    operation: 'mcp_transport', success: false, errorCategory: 'MCP_TRANSPORT', errorCode: 'MCP_ADAPTER_ERROR', metadata: { message: error.message }
  });
  transport.onclose = () => {
    if (transport.sessionId) mcpSessions.delete(transport.sessionId);
  };
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

function goilotTaskKey(req, preboundClientId) {
  if (preboundClientId !== 'goilot-gpt') return null;
  const session = req.headers['x-openai-session'];
  const subject = req.headers['x-openai-subject'];
  if (typeof session !== 'string' || typeof subject !== 'string' || !session || !subject || session.length > 1024 || subject.length > 1024) return null;
  return createHash('sha256').update(`${subject.length}:${subject}${session.length}:${session}`).digest('hex');
}

function requireAuthorization(req) {
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : String(req.headers['x-fadi-browser-token'] || '');
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(apiToken);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new BrokerError('POLICY', 'BROKER_AUTH_REQUIRED', 'A valid local broker credential is required.', undefined, 401);
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new BrokerError('POLICY', 'REQUEST_TOO_LARGE', 'Request body exceeds 1 MiB.', undefined, 413));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new BrokerError('MCP_TRANSPORT', 'INVALID_JSON', 'Request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  if (res.headersSent) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function writeRunningState() {
  const target = config.paths.runningVersion;
  const temp = `${target}.tmp`;
  writeFileSync(temp, JSON.stringify({
    project_version: versions.brokerVersion,
    engine_version: versions.engineVersion,
    running_commit: versions.runningCommit,
    source_dirty: versions.sourceDirty,
    pid: process.pid,
    endpoint: `http://${config.host}:${config.port}/mcp`,
    started_at: nowIso()
  }, null, 2));
  renameSync(temp, target);
  writeFileSync(config.paths.pid, String(process.pid));
}

async function shutdown(preserveRecoverable) {
  if (!shuttingDown) shuttingDown = true;
  httpServer.close();
  try { await broker.shutdown({ preserveRecoverable }); } finally {
    await Promise.all([...mcpSessions.values()].map(async ({ server, transport }) => {
      await transport.close().catch(() => {});
      await server.close?.().catch(() => {});
    }));
    mcpSessions.clear();
    telemetry.close();
    rmSync(config.paths.runningMarker, { force: true });
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown(true));
process.on('SIGTERM', () => void shutdown(true));
process.on('uncaughtException', error => {
  telemetry.event('broker_crashed', { success: false, errorCategory: 'BROKER', errorCode: 'UNCAUGHT_EXCEPTION', metadata: { message: error.message } });
  process.exit(1);
});
process.on('unhandledRejection', error => {
  telemetry.event('broker_crashed', { success: false, errorCategory: 'BROKER', errorCode: 'UNHANDLED_REJECTION', metadata: { message: error?.message || String(error) } });
  process.exit(1);
});

httpServer.listen(config.port, config.host, () => {
  writeFileSync(config.paths.runningMarker, JSON.stringify({ pid: process.pid, started_at: nowIso() }));
  writeRunningState();
  telemetry.event('health_check', { success: true, concurrencyCount: broker.activeCount(), metadata: { endpoint: `http://${config.host}:${config.port}` } });
});
