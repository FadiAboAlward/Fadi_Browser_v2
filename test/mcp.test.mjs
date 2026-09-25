import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrokerMcpServer } from '../src/mcp.mjs';

function fixture() {
  const calls = [];
  const backend = {
    async acquire(input) {
      calls.push(['acquire', input]);
      return { lease_id: 'lease-ref', lease_token: 'r'.repeat(64), session_id: 'session-ref', status: 'ACTIVE' };
    },
    status(input) { calls.push(['status', input]); return { status: 'ACTIVE' }; },
    async release(input) { calls.push(['release', input]); return { status: 'CLOSED' }; },
    async recover(input) { calls.push(['recover', input]); return { status: 'ACTIVE' }; },
    async navigate(input) { calls.push(['navigate', input]); return { ok: true }; },
    async snapshot(input) { calls.push(['snapshot', input]); return { ok: true }; },
    async getUrl(input) { calls.push(['getUrl', input]); return { ok: true }; },
    async getTitle(input) { calls.push(['getTitle', input]); return { ok: true }; },
    async evaluate(input) { calls.push(['evaluate', input]); return { ok: true }; },
    async command(input) { calls.push(['command', input]); return { ok: true }; },
    async restoreWindow(input) { calls.push(['restoreWindow', input]); return { window_state: 'NORMAL' }; }
  };
  return { server: createBrokerMcpServer(backend), calls };
}

async function call(server, name, args = {}) {
  return server._registeredTools[name].handler(args);
}

test('same_task_actions_resolve_server_side_lease', async () => {
  const { server, calls } = fixture();
  await call(server, 'browser_acquire', { client_id: 'client-a' });
  const result = await call(server, 'browser_navigate', { url: 'https://example.com' });
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls.at(-1)[1], { clientId: 'client-a', leaseToken: 'r'.repeat(64), url: 'https://example.com' });
});

test('browser_acquire exposes optional pool without letting the caller choose a slot', async () => {
  const { server, calls } = fixture();
  const properties = server._toolInputSchemaJson.browser_acquire.properties;
  assert.ok('pool_id' in properties);
  assert.equal('browser_slot_id' in properties, false);
  await call(server, 'browser_acquire', { client_id: 'client-a', pool_id: 'default' });
  assert.equal(calls.at(-1)[1].poolId, 'default');
  assert.equal(calls.at(-1)[1].authProfileId, undefined);
});

test('no_public_credential_needed_for_browser_action', async () => {
  const { server } = fixture();
  const ordinary = ['browser_status', 'browser_release', 'browser_navigate', 'browser_snapshot', 'browser_get_url', 'browser_get_title', 'browser_evaluate', 'browser_command', 'browser_restore_window'];
  for (const name of ordinary) {
    const properties = server._toolInputSchemaJson[name].properties || {};
    assert.equal('lease_token' in properties, false, `${name} exposes lease_token`);
    assert.equal('client_id' in properties, false, `${name} exposes client_id`);
  }
  const acquired = await call(server, 'browser_acquire', { client_id: 'client-a' });
  assert.equal('lease_token' in acquired.structuredContent, false);
  assert.equal(typeof acquired.structuredContent.recovery_credential, 'string');
});

test('transport_refresh_retains_task_ownership', async () => {
  const { server, calls } = fixture();
  await call(server, 'browser_acquire', { client_id: 'client-a' });
  await call(server, 'browser_status', {});
  await call(server, 'browser_get_url', {});
  assert.equal(calls.at(-1)[1].clientId, 'client-a');
  assert.equal(calls.at(-1)[1].leaseToken, 'r'.repeat(64));
});

for (const clientId of ['goilot-gpt', 'fadi-gpt']) {
  test(`${clientId} chat identity retains ownership across distinct MCP servers`, async () => {
    const calls = [];
    const backend = {
      acquire: async input => { calls.push(['acquire', input]); return { lease_token: 'r'.repeat(64), status: 'ACTIVE' }; },
      navigate: input => { calls.push(['navigate', input]); return { ok: true }; },
      release: input => { calls.push(['release', input]); return { status: 'CLOSED' }; }
    };
    const chatA = { clientId: null, leaseToken: null };
    const chatB = { clientId: null, leaseToken: null };
    const acquireServer = createBrokerMcpServer(backend, '0.1.0', clientId, chatA);
    const navigateServer = createBrokerMcpServer(backend, '0.1.0', clientId, chatA);
    const otherChatServer = createBrokerMcpServer(backend, '0.1.0', clientId, chatB);
    await call(acquireServer, 'browser_acquire', { pool_id: 'default' });
    assert.equal((await call(otherChatServer, 'browser_navigate', { url: 'https://example.com' })).isError, true);
    assert.equal((await call(navigateServer, 'browser_navigate', { url: 'https://example.com' })).isError, undefined);
    assert.deepEqual(calls.at(-1)[1], { clientId, leaseToken: 'r'.repeat(64), url: 'https://example.com' });
    const releaseServer = createBrokerMcpServer(backend, '0.1.0', clientId, chatA);
    assert.equal((await call(releaseServer, 'browser_release')).isError, undefined);
    assert.equal((await call(navigateServer, 'browser_navigate', { url: 'https://example.com' })).isError, true);
  });
}

test('fresh_chat_has_no_inherited_lease', async () => {
  const first = fixture();
  await call(first.server, 'browser_acquire', { client_id: 'client-a' });
  const fresh = fixture();
  const result = await call(fresh.server, 'browser_get_url', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No session is bound/);
});

test('normal_browser_actions_have_correct_risk_metadata', () => {
  const { server } = fixture();
  for (const name of ['browser_status', 'browser_snapshot', 'browser_get_url', 'browser_get_title']) {
    const annotations = server._registeredTools[name].annotations;
    assert.equal(annotations.readOnlyHint, true, `${name} should be read-only`);
    assert.equal(annotations.destructiveHint, false, `${name} should not be destructive`);
  }
  assert.equal(server._registeredTools.browser_restore_window.annotations.openWorldHint, false);
  assert.equal(server._registeredTools.browser_navigate.annotations.openWorldHint, true);
});

test('authorized_flow_has_zero_unnecessary_lease_prompts', async () => {
  const { server } = fixture();
  await call(server, 'browser_acquire', { client_id: 'client-a' });
  await call(server, 'browser_navigate', { url: 'https://example.com' });
  await call(server, 'browser_snapshot', {});
  const released = await call(server, 'browser_release', {});
  assert.equal(released.isError, undefined);
});
