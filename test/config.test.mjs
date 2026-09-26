import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.mjs';

function twoSlotConfig() {
  const externalChrome = cdpPort => ({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', cdpPort });
  return {
    host: '127.0.0.1', port: 8951,
    clients: {
      'client-a': { defaultAuthProfile: 'goilot', allowedAuthProfiles: ['goilot'], allowedPools: ['default'], defaultPool: 'default' },
      'client-b': { defaultAuthProfile: 'other', allowedAuthProfiles: ['other'], allowedPools: ['default'], defaultPool: 'default' }
    },
    authProfiles: {
      goilot: { persistent: true, mode: 'profile_bound', headed: true, externalChrome: externalChrome(8955) },
      'browser-2': { persistent: true, mode: 'profile_bound', headed: true, externalChrome: externalChrome(8956) },
      other: { persistent: true, mode: 'profile_bound' }
    },
    browserPools: { default: { slots: [
      { id: 'browser-1', authProfileId: 'goilot' },
      { id: 'browser-2', authProfileId: 'browser-2' }
    ] } }
  };
}

function withConfig(raw, fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fadi-v2-config-pool-'));
  const configPath = path.join(root, 'config.json');
  try {
    writeFileSync(configPath, JSON.stringify(raw));
    return fn(loadConfig({ runtimeRoot: root, configPath }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('two shared slots derive separate persistent profile paths and ports', () => {
  const raw = twoSlotConfig();
  withConfig(raw, config => {
    assert.notEqual(config.authProfiles.goilot.profilePath, config.authProfiles['browser-2'].profilePath);
    assert.equal(config.authProfiles.goilot.externalChrome.cdpPort, 8955);
    assert.equal(config.authProfiles['browser-2'].externalChrome.cdpPort, 8956);
  });
});

test('shared slot collision and unauthorized pool policy fail configuration load', () => {
  const raw = twoSlotConfig();
  raw.authProfiles['browser-2'].externalChrome.cdpPort = 8955;
  assert.throws(() => withConfig(raw, () => {}), error => error.code === 'BROWSER_SLOT_COLLISION');
  raw.authProfiles['browser-2'].externalChrome.cdpPort = 8956;
  raw.clients['client-b'].allowedPools = ['missing'];
  assert.throws(() => withConfig(raw, () => {}), error => error.code === 'INVALID_CLIENT_POOL_POLICY');
});
