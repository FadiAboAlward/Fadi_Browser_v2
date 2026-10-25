import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentBrowserEngine } from '../src/engine.mjs';

test('headed_profile_keeps_official_headed_flag_for_every_session_command', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'goilot-headed-engine-'));
  try {
    const cliPath = path.join(root, 'fake-cli.cjs');
    writeFileSync(cliPath, "console.log(JSON.stringify({ data: { pid: 42, runtime: { executablePath: 'chrome.exe' } }, argv: process.argv.slice(2) }));\n");
    const engine = new AgentBrowserEngine({ projectRoot: root, namespace: 'test', retentionDays: 1, headed: false }, { cliPath });
    const profilePath = path.join(root, 'goilot');
    const created = await engine.createSession('goilot-session', 'goilot', { mode: 'profile_bound', profilePath, persistent: true, headed: true });
    assert.ok(created.output.argv.includes('--headed'));
    assert.equal(created.output.argv.at(-2), 'open');
    assert.equal(created.diagnostics.visible, true);
    const navigated = await engine.navigate('goilot-session', 'https://example.com');
    assert.ok(navigated.output.argv.includes('--headed'));
    const closed = await engine.closeSession('goilot-session');
    assert.ok(closed.output.argv.includes('--headed'));
    const ordinary = await engine.createSession('ordinary-session', 'public', { mode: 'portable', headed: false });
    assert.equal(ordinary.output.argv.includes('--headed'), false);
    await engine.closeSession('ordinary-session');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('external_chrome_attaches_without_replacing_page_and_detaches_on_release', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'goilot-external-engine-'));
  try {
    const cliPath = path.join(root, 'fake-cli.cjs');
    writeFileSync(cliPath, "const argv=process.argv.slice(2); const tabs=argv.at(-1)==='tab'?[{type:'page',targetId:'known-target'}]:undefined; console.log(JSON.stringify({data:{tabs},argv}));\n");
    const externalChrome = { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', cdpPort: 8955 };
    const profilePath = path.join(root, 'goilot');
    let ensured = 0;
    const engine = new AgentBrowserEngine({ projectRoot: root, namespace: 'test', retentionDays: 1, headed: false }, {
      cliPath,
      ensureExternalChrome: async () => { ensured += 1; },
      inspectExternalChrome: async () => ({ owned: true, portOwner: 123, visible: true, windowHandle: '456' })
    });
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ type: 'page', id: 'known-target' }] });
    let created;
    try {
      created = await engine.createSession('attached', 'goilot', { mode: 'profile_bound', profilePath, externalChrome, headed: true });
    } finally {
      globalThis.fetch = oldFetch;
    }
    assert.equal(ensured, 1);
    assert.deepEqual(created.output.argv.slice(-2), ['get', 'url']);
    assert.equal(created.output.argv.includes('--cdp'), false);
    assert.equal(created.output.argv.includes('--headed'), false);
    assert.ok(created.output.argv.includes('test-goilot-external-cdp'));
    assert.equal(created.output.argv.includes('--profile'), false);
    assert.equal(created.diagnostics.process_id, 123);
    assert.equal(created.diagnostics.visible, true);
    const closed = await engine.closeSession('attached');
    assert.equal(closed.output.argv.at(-1), 'close');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('external_chrome_fails_closed_when_agent_browser_targets_another_process', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'goilot-cdp-mismatch-'));
  try {
    const cliPath = path.join(root, 'fake-cli.cjs');
    writeFileSync(cliPath, "const argv=process.argv.slice(2); const tabs=argv.at(-1)==='tab'?[{type:'page',targetId:'wrong-target'}]:undefined; console.log(JSON.stringify({data:{tabs},argv}));\n");
    const engine = new AgentBrowserEngine({ projectRoot: root, namespace: 'test', retentionDays: 1 }, {
      cliPath,
      ensureExternalChrome: async () => {},
      inspectExternalChrome: async () => ({ owned: true, portOwner: 123, visible: true, windowHandle: '456' })
    });
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ type: 'page', id: 'expected-target' }] });
    try {
      await assert.rejects(
        engine.createSession('wrong', 'goilot', {
          mode: 'profile_bound', profilePath: path.join(root, 'goilot'), headed: true,
          externalChrome: { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', cdpPort: 8955 }
        }),
        { code: 'CDP_ATTACH_MISMATCH' }
      );
    } finally {
      globalThis.fetch = oldFetch;
    }
    assert.equal(engine.externalSessions.has('wrong'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('waitForCondition passes correct arguments and timeout', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wait-for-cond-'));
  try {
    const cliPath = path.join(root, 'fake-cli.cjs');
    writeFileSync(cliPath, "console.log(JSON.stringify({ data: { result: 'ok' }, argv: process.argv.slice(2) }));\n");
    const engine = new AgentBrowserEngine({ projectRoot: root, namespace: 'test', retentionDays: 1, headed: false }, { cliPath });
    const res = await engine.waitForCondition('test-session', { textGone: 'loading', timeoutMs: 5000 });
    const argv = res.output.argv;
    assert.ok(argv.includes('--timeout'));
    assert.ok(argv.includes('5000'));
    assert.ok(argv.includes('--fn'));
    assert.ok(argv.join(' ').includes('document.body?.innerText'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('external resize targets only the active agent-browser tab and checks its real width', async () => {
  const engine = new AgentBrowserEngine({ projectRoot: '.', namespace: 'test', retentionDays: 1 });
  engine.externalSessions.set('attached', { cdpPort: 8955 });
  engine.run = async (_sessionId, args) => {
    assert.deepEqual(args, ['tab']);
    return { output: { data: { tabs: [
      { type: 'page', targetId: 'background-tab', active: false },
      { type: 'page', targetId: 'correct-tab', active: true }
    ] } } };
  };
  engine.evaluate = async (_sessionId, script) => {
    assert.match(script, /window.innerWidth/);
    return { output: { data: { result: JSON.stringify({ width: 1440, height: 900 }) } } };
  };
  const oldFetch = globalThis.fetch;
  const oldWebSocket = globalThis.WebSocket;
  let selectedUrl = null;
  let cdpMethod = null;
  globalThis.fetch = async () => ({ ok: true, json: async () => [
    { type: 'page', id: 'background-tab', webSocketDebuggerUrl: 'ws://local/background' },
    { type: 'page', id: 'correct-tab', webSocketDebuggerUrl: 'ws://local/correct' }
  ] });
  globalThis.WebSocket = class {
    constructor(url) { selectedUrl = url; queueMicrotask(() => this.onopen?.()); }
    send(json) {
      cdpMethod = JSON.parse(json).method;
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: 1, result: {} }) }));
    }
    close() {}
  };
  try {
    const result = await engine.resize('attached', 1440, 900);
    assert.equal(result.ok, true);
    assert.equal(result.output.targetId, 'correct-tab');
    assert.equal(result.output.actualWidth, 1440);
    assert.equal(result.output.actualHeight, 900);
    assert.equal(selectedUrl, 'ws://local/correct');
    assert.equal(cdpMethod, 'Emulation.setDeviceMetricsOverride');
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldWebSocket;
  }
});

test('external resize rejects CDP acknowledgement when the actual viewport stays narrow', async () => {
  const engine = new AgentBrowserEngine({ projectRoot: '.', namespace: 'test', retentionDays: 1 });
  engine.externalSessions.set('attached', { cdpPort: 8955 });
  engine.run = async () => ({ output: { data: { tabs: [
    { type: 'page', targetId: 'correct-tab', active: true }
  ] } } });
  engine.evaluate = async () => ({ output: { data: { result: JSON.stringify({ width: 500, height: 591 }) } } });
  const oldFetch = globalThis.fetch;
  const oldWebSocket = globalThis.WebSocket;
  globalThis.fetch = async () => ({ ok: true, json: async () => [
    { type: 'page', id: 'correct-tab', webSocketDebuggerUrl: 'ws://local/correct' }
  ] });
  globalThis.WebSocket = class {
    constructor() { queueMicrotask(() => this.onopen?.()); }
    send() { queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: 1, result: {} }) })); }
    close() {}
  };
  try {
    await assert.rejects(engine.resize('attached', 1440, 900), { code: 'VIEWPORT_MISMATCH' });
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldWebSocket;
  }
});

test('external resize refuses to guess a target when active tab is unknown', async () => {
  const engine = new AgentBrowserEngine({ projectRoot: '.', namespace: 'test', retentionDays: 1 });
  engine.externalSessions.set('attached', { cdpPort: 8955 });
  engine.run = async () => ({ output: { data: { tabs: [
    { type: 'page', targetId: 'tab-a' }, { type: 'page', targetId: 'tab-b' }
  ] } } });
  await assert.rejects(engine.resize('attached', 1440, 900), { code: 'VIEWPORT_TARGET_UNKNOWN' });
});

test('ordinary agent-browser resize also verifies effective viewport', async () => {
  const engine = new AgentBrowserEngine({ projectRoot: '.', namespace: 'test', retentionDays: 1 });
  engine.run = async (_sessionId, args) => {
    assert.deepEqual(args, ['set', 'viewport', '1440', '900']);
    return { ok: true };
  };
  engine.evaluate = async () => ({ output: { data: { result: '{"width":500,"height":591}' } } });
  await assert.rejects(engine.resize('ordinary', 1440, 900), { code: 'VIEWPORT_MISMATCH' });
});
