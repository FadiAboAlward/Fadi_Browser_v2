import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { BrokerApiClient } from '../src/api-client.mjs';

async function freePort() {
  return new Promise(resolve => {
    const srv = net.createServer().listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function runSmokeTest() {
  console.log('Starting Phase 1 QA Smoke Test...');
  const port = await freePort();
  const root = mkdtempSync(path.join(os.tmpdir(), 'fadi-smoke-'));
  const apiToken = randomBytes(32).toString('hex');
  const encKey = randomBytes(32).toString('hex');

  // Create config
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const configRaw = JSON.parse(readFileSync(path.join(projectRoot, 'config', 'config.example.json'), 'utf8'));
  configRaw.runtimeRoot = root;
  configRaw.port = port;
  configRaw.namespace = `fadi-smoke-${randomBytes(4).toString('hex')}`;
  
  const configPath = path.join(root, 'config.json');
  writeFileSync(configPath, JSON.stringify(configRaw, null, 2));

  console.log(`[+] Port: ${port}, Root: ${root}`);

  const server = spawn(process.execPath, ['src/server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      FADI_BROWSER_V2_RUNTIME_ROOT: root,
      FADI_BROWSER_V2_CONFIG: configPath,
      FADI_BROWSER_V2_API_TOKEN: apiToken,
      AGENT_BROWSER_ENCRYPTION_KEY: encKey
    }
  });

  server.stderr.on('data', d => {
    const msg = d.toString().trim();
    if (!msg.includes('ExperimentalWarning: SQLite')) {
      console.error(`[Server Log] ${msg}`);
    }
  });

  const client = new BrokerApiClient(`http://127.0.0.1:${port}`, apiToken);

  // Wait for health
  let healthy = false;
  for (let i = 0; i < 40; i++) {
    try {
      await new Promise(r => setTimeout(r, 500));
      const status = await client.status();
      if (status.broker === 'HEALTHY') {
        healthy = true;
        break;
      }
    } catch {}
  }

  if (!healthy) {
    server.kill();
    throw new Error('Server failed to start or become healthy');
  }

  console.log('[+] Server healthy');

  try {
    // 1. Acquire
    console.log('[+] 1. Acquire');
    const lease = await client.acquire({ clientId: 'maintenance' });
    const auth = { clientId: lease.client_id, leaseToken: lease.lease_token };
    
    // 2. Navigate
    console.log('[+] 2. Navigate');
    await client.navigate({ ...auth, url: 'https://example.com' });
    
    // 3. Inject side effects
    console.log('[+] 3. Inject Side Effects');
    await client.evaluate({ ...auth, script: 'console.log("smoke log"); console.error("smoke error"); setTimeout(() => fetch("https://example.com/?secret=123").catch(()=>console.log("fetch err")), 100);' });

    // 4. Wait
    console.log('[+] 4. Wait for condition (demonstrating wait functionality)');
    await client.waitForCondition({ ...auth, text: 'Example Domain', timeoutMs: 5000 });

    // 5. Screenshot
    console.log('[+] 5. Screenshot');
    const snap = await client.screenshot({ ...auth, fullPage: true });
    if (!snap.output || !snap.output.data || !snap.output.data.path) {
      console.error('Screenshot response:', JSON.stringify(snap));
      throw new Error('No screenshot path returned');
    }
    console.log(`    -> Screenshot saved at ${snap.output.data.path}`);

    // 5. Console
    console.log('[+] 5. Console Messages');
    const cons = await client.consoleMessages({ ...auth });
    if (!cons.output || !cons.output.data || !Array.isArray(cons.output.data.messages)) {
      console.error('Console response:', JSON.stringify(cons));
      throw new Error('No console messages returned');
    }
    if (!cons.output.data.messages.some(m => String(m.text).includes('smoke log'))) {
      throw new Error('Console message not captured');
    }

    // 6. Errors
    console.log('[+] 6. Page Errors');
    const errs = await client.pageErrors({ ...auth });
    if (!errs.ok || !errs.output || !errs.output.data || !Array.isArray(errs.output.data.errors)) {
      console.error('Errors response:', JSON.stringify(errs));
      throw new Error('Page errors call failed');
    }

    // 7. Network
    console.log('[+] 7. Network Requests');
    // Give fetch a moment to fire
    await new Promise(r => setTimeout(r, 1000));
    const netReqs = await client.networkRequests({ ...auth });
    if (!netReqs.output || !netReqs.output.data || !Array.isArray(netReqs.output.data.requests)) {
      console.error('Network response:', JSON.stringify(netReqs));
      throw new Error('Network requests missing');
    }

    // 8. Resize
    console.log('[+] 8. Resize');
    const resize = await client.resize({ ...auth, width: 800, height: 600 });
    if (!resize.output) {
      console.error('Resize response:', JSON.stringify(resize));
      throw new Error('Resize failed');
    }

    // 9. Release
    console.log('[+] 9. Release');
    await client.release({ ...auth });

    console.log('\n✅ SMOKE TEST PASSED!');
  } catch (innerError) {
    console.error('\n❌ QA TEST SEQUENCE FAILED:', innerError);
    throw innerError;
  } finally {
    server.kill();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (rmError) {
      console.error('Cleanup warning (EPERM expected on Windows):', rmError.message);
    }
  }
}

runSmokeTest().catch(err => {
  console.error('\n❌ SMOKE TEST FAILED:', err);
  process.exit(1);
});
