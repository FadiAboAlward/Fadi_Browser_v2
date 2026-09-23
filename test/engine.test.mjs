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
