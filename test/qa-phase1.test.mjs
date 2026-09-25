import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LeaseBroker } from '../src/broker.mjs';
import { Telemetry } from '../src/telemetry.mjs';
import { createBrokerMcpServer } from '../src/mcp.mjs';

// --- Fake engine with QA capabilities ---

class FakeEngine {
  constructor() { this.sessions = new Map(); }

  async createSession(sessionId) {
    this.sessions.set(sessionId, {
      url: 'about:blank',
      title: '',
      console: [
        { level: 'log', text: 'page loaded' },
        { level: 'error', text: 'something failed' }
      ],
      errors: [
        { message: 'Uncaught TypeError: x is not a function', source: 'test.js', line: 42 }
      ],
      networkRequests: [
        { id: '1.1', url: 'https://example.com/', method: 'GET', status: 200, type: 'document', timing: 120 },
        { id: '1.2', url: 'https://example.com/api?token=secret123', method: 'POST', status: 200, type: 'xhr', timing: 50 }
      ],
      viewport: { width: 1280, height: 720 }
    });
    return { ok: true, diagnostics: { executable: 'fake-chrome', process_id: 42, window_state: 'HIDDEN', visible: false, safe_window_id: 'pid-42', active_title: null } };
  }

  async navigate(sessionId, url) {
    this.sessions.get(sessionId).url = url;
    this.sessions.get(sessionId).title = 'Example Domain';
    return { ok: true, output: { url } };
  }

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

  // --- QA capabilities ---

  async screenshot(sessionId, options = {}) {
    if (!this.sessions.has(sessionId)) throw new Error('gone');
    return { ok: true, output: { data: { path: '/fake/path/screenshot.png' }, full_page: Boolean(options.fullPage) } };
  }

  async resize(sessionId, width, height) {
    if (!this.sessions.has(sessionId)) throw new Error('gone');
    this.sessions.get(sessionId).viewport = { width, height };
    return { ok: true, output: { width, height } };
  }

  async consoleMessages(sessionId, options = {}) {
    if (!this.sessions.has(sessionId)) throw new Error('gone');
    const session = this.sessions.get(sessionId);
    const messages = [...session.console];
    if (options.clear) session.console = [];
    return { ok: true, output: { data: { messages } } };
  }

  async pageErrors(sessionId, options = {}) {
    if (!this.sessions.has(sessionId)) throw new Error('gone');
    const session = this.sessions.get(sessionId);
    const errors = [...session.errors];
    if (options.clear) session.errors = [];
    return { ok: true, output: { data: { errors } } };
  }

  async networkRequests(sessionId, options = {}) {
    if (!this.sessions.has(sessionId)) throw new Error('gone');
    const session = this.sessions.get(sessionId);
    let requests = [...session.networkRequests];
    if (options.filter) requests = requests.filter(r => r.url.includes(options.filter));
    if (options.method) requests = requests.filter(r => r.method === options.method);
    return {
      ok: true,
      output: {
        data: {
          requests: requests.map(r => ({
            ...r,
            headers: { 'content-type': 'text/html', authorization: 'Bearer secret-token-here', cookie: 'session=abc123' }
          }))
        }
      }
    };
  }

  async networkRequestDetail(sessionId, requestId) {
    if (!this.sessions.has(sessionId)) throw new Error('gone');
    const session = this.sessions.get(sessionId);
    const req = session.networkRequests.find(r => r.id === String(requestId));
    if (!req) return { ok: true, output: { data: null } };
    return {
      ok: true,
      output: {
        data: {
          request: {
            ...req,
            headers: { 'content-type': 'text/html', authorization: 'Bearer secret-token', 'set-cookie': 'sid=xyz; HttpOnly', 'x-request-id': 'abc' },
            responseHeaders: { 'content-type': 'application/json', 'set-cookie': 'token=secret; Secure', 'x-powered-by': 'node' },
            body: '<!DOCTYPE html><html>...</html>'
          }
        }
      }
    };
  }

  async waitForCondition(sessionId, options = {}) {
    if (!this.sessions.has(sessionId)) throw new Error('gone');
    return { ok: true, output: { condition_met: true, waited_ms: 50 } };
  }
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fadi-browser-v2-qa1-'));
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
      maintenance: { defaultAuthProfile: 'public', allowedAuthProfiles: ['public', 'auth-profile-a', 'auth-profile-b'] }
    },
    authProfiles: {
      public: { persistent: false, mode: 'portable' },
      'auth-profile-a': { persistent: true, mode: 'portable' },
      'auth-profile-b': { persistent: true, mode: 'portable' }
    }
  };
  const telemetry = new Telemetry(config, { brokerVersion: 'test', engineVersion: 'test' });
  const engine = new FakeEngine();
  const broker = new LeaseBroker(config, telemetry, engine, { brokerVersion: 'test', engineVersion: 'test' });
  return { root, config, telemetry, engine, broker };
}

// --- Screenshot tests ---

test('screenshot captures current page', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    const result = await f.broker.screenshot({ clientId: 'maintenance', leaseToken: lease.lease_token });
    assert.equal(result.ok, true);
    assert.equal(result.output.data.path, '/fake/path/screenshot.png');
    assert.equal(result.output.full_page, false);
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('screenshot full page option passes through', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    const result = await f.broker.screenshot({ clientId: 'maintenance', leaseToken: lease.lease_token, fullPage: true });
    assert.equal(result.output.full_page, true);
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

// --- Console messages tests ---

test('console_messages returns session console logs', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    const result = await f.broker.consoleMessages({ clientId: 'maintenance', leaseToken: lease.lease_token });
    assert.equal(result.ok, true);
    assert.equal(result.output.data.messages.length, 2);
    assert.equal(result.output.data.messages[0].level, 'log');
    assert.equal(result.output.data.messages[1].level, 'error');
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

// --- Page errors tests ---

test('page_errors returns captured errors', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    const result = await f.broker.pageErrors({ clientId: 'maintenance', leaseToken: lease.lease_token });
    assert.equal(result.ok, true);
    assert.equal(result.output.data.errors.length, 1);
    assert.ok(result.output.data.errors[0].message.includes('TypeError'));
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

// --- Network requests tests with redaction ---

test('network_requests redacts sensitive headers', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    const result = await f.broker.networkRequests({ clientId: 'maintenance', leaseToken: lease.lease_token });
    assert.equal(result.ok, true);
    const requests = result.output.data.requests;
    assert.ok(requests.length >= 1);
    // Verify authorization header is redacted
    for (const req of requests) {
      assert.equal(req.headers.authorization, '[REDACTED]');
      assert.equal(req.headers.cookie, '[REDACTED]');
      // Safe headers should remain
      assert.equal(req.headers['content-type'], 'text/html');
    }
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('network_requests redacts sensitive URL parameters', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    const result = await f.broker.networkRequests({ clientId: 'maintenance', leaseToken: lease.lease_token });
    const apiReq = result.output.data.requests.find(r => r.url.includes('api'));
    assert.ok(apiReq, 'Should find the API request');
    assert.ok(!apiReq.url.includes('secret123'), 'Token value should be redacted from URL');
    assert.ok(apiReq.url.includes('[REDACTED]'), 'URL should contain [REDACTED] placeholder');
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('network_request_details redacts sensitive headers', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    const result = await f.broker.networkRequestDetail({ clientId: 'maintenance', leaseToken: lease.lease_token, requestId: '1.1' });
    assert.equal(result.ok, true);
    // Request headers
    assert.equal(result.output.data.request.headers.authorization, '[REDACTED]');
    assert.equal(result.output.data.request.headers['set-cookie'], '[REDACTED]');
    assert.equal(result.output.data.request.headers['x-request-id'], 'abc');
    // Response headers
    assert.equal(result.output.data.request.responseHeaders['set-cookie'], '[REDACTED]');
    assert.equal(result.output.data.request.responseHeaders['x-powered-by'], 'node');
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('network_request_details rejects missing request_id', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    await assert.rejects(
      () => f.broker.networkRequestDetail({ clientId: 'maintenance', leaseToken: lease.lease_token, requestId: '' }),
      error => error.code === 'INVALID_REQUEST_ID'
    );
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

// --- Wait for condition tests ---

test('wait_for_condition succeeds', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    const result = await f.broker.waitForCondition({ clientId: 'maintenance', leaseToken: lease.lease_token, text: 'Example' });
    assert.equal(result.ok, true);
    assert.equal(result.output.condition_met, true);
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

// --- Resize tests ---

test('resize changes viewport dimensions', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    const result = await f.broker.resize({ clientId: 'maintenance', leaseToken: lease.lease_token, width: 375, height: 812 });
    assert.equal(result.ok, true);
    assert.equal(result.output.width, 375);
    assert.equal(result.output.height, 812);
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('resize rejects invalid dimensions', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    await assert.rejects(
      () => f.broker.resize({ clientId: 'maintenance', leaseToken: lease.lease_token, width: 0, height: 100 }),
      error => error.code === 'INVALID_VIEWPORT'
    );
    await assert.rejects(
      () => f.broker.resize({ clientId: 'maintenance', leaseToken: lease.lease_token, width: 100, height: -1 }),
      error => error.code === 'INVALID_VIEWPORT'
    );
    await assert.rejects(
      () => f.broker.resize({ clientId: 'maintenance', leaseToken: lease.lease_token, width: 10000, height: 100 }),
      error => error.code === 'INVALID_VIEWPORT'
    );
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

// --- Session isolation tests ---

test('qa tools reject cross-client access', async () => {
  const f = fixture();
  try {
    const leaseA = await f.broker.acquire({ clientId: 'client-a' });
    // client-b should not access client-a's session for any QA tool
    const crossTools = [
      () => f.broker.screenshot({ clientId: 'client-b', leaseToken: leaseA.lease_token }),
      () => f.broker.consoleMessages({ clientId: 'client-b', leaseToken: leaseA.lease_token }),
      () => f.broker.pageErrors({ clientId: 'client-b', leaseToken: leaseA.lease_token }),
      () => f.broker.networkRequests({ clientId: 'client-b', leaseToken: leaseA.lease_token }),
      () => f.broker.networkRequestDetail({ clientId: 'client-b', leaseToken: leaseA.lease_token, requestId: '1' }),
      () => f.broker.waitForCondition({ clientId: 'client-b', leaseToken: leaseA.lease_token, text: 'test' }),
      () => f.broker.resize({ clientId: 'client-b', leaseToken: leaseA.lease_token, width: 100, height: 100 })
    ];
    for (const toolCall of crossTools) {
      await assert.rejects(toolCall, error => error.code === 'LEASE_OWNER_MISMATCH');
    }
    await f.broker.release({ clientId: 'client-a', leaseToken: leaseA.lease_token });
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('qa tools reject released session', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
    await assert.rejects(
      () => f.broker.screenshot({ clientId: 'maintenance', leaseToken: lease.lease_token }),
      error => error.code === 'INVALID_LEASE_TOKEN'
    );
    await assert.rejects(
      () => f.broker.consoleMessages({ clientId: 'maintenance', leaseToken: lease.lease_token }),
      error => error.code === 'INVALID_LEASE_TOKEN'
    );
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

// --- MCP tool metadata tests ---

test('qa_tools_have_correct_risk_metadata', async () => {
  const calls = [];
  const backend = {
    async acquire(input) { calls.push(['acquire', input]); return { lease_id: 'lease-ref', lease_token: 'r'.repeat(64), session_id: 'session-ref', status: 'ACTIVE' }; },
    status(input) { calls.push(['status', input]); return { status: 'ACTIVE' }; },
    async release(input) { calls.push(['release', input]); return { status: 'CLOSED' }; },
    async recover(input) { calls.push(['recover', input]); return { status: 'ACTIVE' }; },
    async navigate(input) { calls.push(['navigate', input]); return { ok: true }; },
    async snapshot(input) { calls.push(['snapshot', input]); return { ok: true }; },
    async getUrl(input) { calls.push(['getUrl', input]); return { ok: true }; },
    async getTitle(input) { calls.push(['getTitle', input]); return { ok: true }; },
    async evaluate(input) { calls.push(['evaluate', input]); return { ok: true }; },
    async command(input) { calls.push(['command', input]); return { ok: true }; },
    async restoreWindow(input) { calls.push(['restoreWindow', input]); return { ok: true }; },
    async screenshot(input) { calls.push(['screenshot', input]); return { ok: true }; },
    async consoleMessages(input) { calls.push(['consoleMessages', input]); return { ok: true }; },
    async pageErrors(input) { calls.push(['pageErrors', input]); return { ok: true }; },
    async networkRequests(input) { calls.push(['networkRequests', input]); return { ok: true }; },
    async networkRequestDetail(input) { calls.push(['networkRequestDetail', input]); return { ok: true }; },
    async waitForCondition(input) { calls.push(['waitForCondition', input]); return { ok: true }; },
    async resize(input) { calls.push(['resize', input]); return { ok: true }; }
  };
  const server = createBrokerMcpServer(backend);
  const tools = server._registeredTools;

  // Verify read-only tools
  const readOnlyTools = ['browser_screenshot', 'browser_console_messages', 'browser_page_errors', 'browser_network_requests', 'browser_network_request_details'];
  for (const toolName of readOnlyTools) {
    assert.ok(tools[toolName], `Tool ${toolName} should be registered`);
    const annotations = tools[toolName].annotations;
    assert.equal(annotations.readOnlyHint, true, `${toolName} should be readOnly`);
    assert.equal(annotations.destructiveHint, false, `${toolName} should not be destructive`);
  }

  // Verify resize is not read-only but not destructive
  assert.ok(tools.browser_resize, 'browser_resize should be registered');
  assert.equal(tools.browser_resize.annotations.readOnlyHint, false, 'resize is not read-only');
  assert.equal(tools.browser_resize.annotations.destructiveHint, false, 'resize is not destructive');
  assert.equal(tools.browser_resize.annotations.idempotentHint, true, 'resize is idempotent');

  // Verify wait is not idempotent
  assert.ok(tools.browser_wait_for_condition, 'browser_wait_for_condition should be registered');
  assert.equal(tools.browser_wait_for_condition.annotations.idempotentHint, false, 'wait is not idempotent');

  // Verify no QA tool exposes lease_token or client_id in schema
  const qaTools = ['browser_screenshot', 'browser_console_messages', 'browser_page_errors', 'browser_network_requests', 'browser_network_request_details', 'browser_wait_for_condition', 'browser_resize'];
  for (const toolName of qaTools) {
    const properties = server._toolInputSchemaJson[toolName].properties || {};
    assert.ok(!('lease_token' in properties), `${toolName} should not expose lease_token`);
    assert.ok(!('client_id' in properties), `${toolName} should not expose client_id`);
  }
});

test('qa_tools_resolve_server_side_lease', async () => {
  const calls = [];
  const backend = {
    async acquire() { return { lease_id: 'l1', lease_token: 'r'.repeat(64), session_id: 's1', status: 'ACTIVE' }; },
    status() { return { status: 'ACTIVE' }; },
    async release(input) { calls.push(['release', input]); return { status: 'CLOSED' }; },
    async recover() { return { status: 'ACTIVE' }; },
    async navigate() { return { ok: true }; },
    async snapshot() { return { ok: true }; },
    async getUrl() { return { ok: true }; },
    async getTitle() { return { ok: true }; },
    async evaluate() { return { ok: true }; },
    async command() { return { ok: true }; },
    async restoreWindow() { return { ok: true }; },
    async screenshot(input) { calls.push(['screenshot', input]); return { ok: true }; },
    async consoleMessages(input) { calls.push(['consoleMessages', input]); return { ok: true }; },
    async pageErrors(input) { calls.push(['pageErrors', input]); return { ok: true }; },
    async networkRequests(input) { calls.push(['networkRequests', input]); return { ok: true }; },
    async networkRequestDetail(input) { calls.push(['networkRequestDetail', input]); return { ok: true }; },
    async waitForCondition(input) { calls.push(['waitForCondition', input]); return { ok: true }; },
    async resize(input) { calls.push(['resize', input]); return { ok: true }; }
  };

  const server = createBrokerMcpServer(backend);
  const call = async (name, args = {}) => server._registeredTools[name].handler(args);

  // Acquire to bind context
  await call('browser_acquire', { client_id: 'test-client' });

  // Call each QA tool and verify the lease was resolved server-side
  await call('browser_screenshot', {});
  await call('browser_console_messages', {});
  await call('browser_page_errors', {});
  await call('browser_network_requests', {});
  await call('browser_network_request_details', { request_id: '1' });
  await call('browser_wait_for_condition', { text: 'hello' });
  await call('browser_resize', { width: 375, height: 812 });

  // All calls should have clientId and leaseToken injected server-side
  const expectedToken = 'r'.repeat(64);
  for (const [method, input] of calls) {
    if (method === 'release') continue;
    assert.equal(input.clientId, 'test-client', `${method} should receive bound clientId`);
    assert.equal(input.leaseToken, expectedToken, `${method} should receive bound leaseToken`);
  }
});

// --- Existing workflow regression test ---

test('acquire_release_workflow_still_works_after_qa_additions', async () => {
  const f = fixture();
  try {
    const lease = await f.broker.acquire({ clientId: 'maintenance' });
    assert.equal(lease.status, 'ACTIVE');
    assert.equal(f.broker.activeCount(), 1);

    // Navigate still works
    const nav = await f.broker.navigate({ clientId: 'maintenance', leaseToken: lease.lease_token, url: 'https://example.com' });
    assert.equal(nav.ok, true);

    // Snapshot still works
    const snap = await f.broker.snapshot({ clientId: 'maintenance', leaseToken: lease.lease_token });
    assert.equal(snap.ok, true);

    // Release still works
    await f.broker.release({ clientId: 'maintenance', leaseToken: lease.lease_token });
    assert.equal(f.broker.activeCount(), 0);

    // Status still works
    const status = f.broker.status();
    assert.equal(status.broker, 'HEALTHY');
    assert.equal(status.sessions_active, 0);
    assert.equal(status.sessions_queued, 0);
  } finally {
    await f.broker.shutdown({ preserveRecoverable: true });
    f.telemetry.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
