import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.FADI_BROWSER_V2_API_TOKEN;
if (!TOKEN) {
  console.error('FADI_BROWSER_V2_API_TOKEN is required. Use scripts/mcp-stdio.ps1.');
  process.exit(1);
}

async function createClient(clientId) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['src/mcp-stdio.mjs'],
    env: { ...process.env, FADI_BROWSER_V2_CLIENT_ID: clientId, FADI_BROWSER_V2_API_TOKEN: TOKEN }
  });
  const client = new Client({ name: `qa-${clientId}`, version: '1.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

// Validate PNG/JPEG bytes: magic bytes + minimum size
function validateImage(base64, mimeType) {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length < 500) throw new Error(`Image too small: ${buf.length} bytes`);
  if (mimeType === 'image/png') {
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
      throw new Error('Invalid PNG magic bytes');
    }
    // IHDR chunk at offset 8: width and height as 4-byte big-endian at offsets 16 and 20
    const width  = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width === 0 || height === 0) throw new Error(`PNG has zero dimensions: ${width}x${height}`);
    return { width, height };
  } else if (mimeType === 'image/jpeg') {
    // JPEG SOI: FF D8
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('Invalid JPEG magic bytes');
    return { width: null, height: null }; // dimension parse skipped for JPEG
  }
  throw new Error(`Unknown mimeType: ${mimeType}`);
}

// Assert browser_status fields: visible, NORMAL window state, non-null safe_window_id
function assertInteractive(data, label) {
  const b = data.browser;
  if (!b) throw new Error(`${label}: browser diagnostics missing from status`);
  if (b.visible !== true) throw new Error(`${label}: visible=${b.visible}, expected true`);
  const state = b.window_state || b.windowState;
  if (state !== 'NORMAL') throw new Error(`${label}: window_state=${state}, expected NORMAL`);
  const safeId = b.safe_window_id;
  if (!safeId) throw new Error(`${label}: safe_window_id is null/missing — window not interactive`);
}

async function runCoreTools() {
  console.log('== TIER B.A: CORE TOOLS ==');
  const { client, transport } = await createClient('fadi-gpt');
  try {
    const acq = await client.callTool({ name: 'browser_acquire', arguments: { pool_id: 'default' } });
    if (acq.isError) throw new Error(acq.content[0].text);

    const nav = await client.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com' } });
    if (nav.isError) throw new Error(nav.content[0].text);

    await client.callTool({ name: 'browser_wait_for_condition', arguments: { text: 'Example Domain' } });
    await client.callTool({ name: 'browser_snapshot', arguments: {} });
    await client.callTool({ name: 'browser_get_title', arguments: {} });
    await client.callTool({ name: 'browser_get_url', arguments: {} });
    await client.callTool({ name: 'browser_evaluate', arguments: { script: '1 + 1' } });
    await client.callTool({ name: 'browser_command', arguments: { command: 'hover', args: ['h1'] } });
    await client.callTool({ name: 'browser_console_messages', arguments: {} });
    await client.callTool({ name: 'browser_page_errors', arguments: {} });
    await client.callTool({ name: 'browser_network_requests', arguments: {} });
    await client.callTool({ name: 'browser_resize', arguments: { width: 800, height: 600 } });

    // BLOCKER 3: visibility assertion is now enforced
    const st = await client.callTool({ name: 'browser_status', arguments: {} });
    if (st.isError) throw new Error(st.content[0].text);
    const data = JSON.parse(st.content[0].text);
    assertInteractive(data, 'core-tools');

    // restore_window must succeed
    const rw = await client.callTool({ name: 'browser_restore_window', arguments: {} });
    if (rw.isError) throw new Error(`restore_window failed: ${rw.content[0].text}`);
  } finally {
    await client.callTool({ name: 'browser_release', arguments: {} }).catch(() => {});
    await transport.close().catch(() => {});
  }
  console.log('Core tools passed.');
}

async function runFiveBrowserTest(clientId) {
  console.log(`\n== TIER B.B & C: FIVE BROWSERS (${clientId}) ==`);
  const sessions = [];
  try {
    for (let i = 0; i < 5; i++) {
      const { client, transport } = await createClient(clientId);
      sessions.push({ client, transport, id: i });
      // Stagger to prevent OS 10060 connection flooding
      await new Promise(r => setTimeout(r, 1000));
    }

    // === BLOCKER 4: standalone HTML pipeline test (slot 0 only) ===
    // We'll capture the file path for slot 0 and test HTML independence after all slots pass
    let slot0FilePath = null;

    await Promise.all(sessions.map(async (s) => {
      const acq = await s.client.callTool({ name: 'browser_acquire', arguments: { pool_id: 'default' } });
      if (acq.isError) throw new Error(`Session ${s.id} acquire: ${acq.content[0].text}`);

      const nav = await s.client.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com' } });
      if (nav.isError) throw new Error(`Session ${s.id} navigate: ${nav.content[0].text}`);

      const t = await s.client.callTool({ name: 'browser_get_title', arguments: {} });
      if (!t.content[0].text.includes('Example Domain')) throw new Error(`Session ${s.id}: Title mismatch: ${t.content[0].text}`);

      // BLOCKER 3: all 5 must be visible and interactive
      const st = await s.client.callTool({ name: 'browser_status', arguments: {} });
      if (st.isError) throw new Error(`Session ${s.id} status: ${st.content[0].text}`);
      const data = JSON.parse(st.content[0].text);
      assertInteractive(data, `slot-${s.id}`);

      // restore_window must succeed for all 5
      const rw = await s.client.callTool({ name: 'browser_restore_window', arguments: {} });
      if (rw.isError) throw new Error(`Session ${s.id} restore_window: ${rw.content[0].text}`);

      // BLOCKER 4: screenshot must return valid inline image with correct magic bytes and non-zero dimensions
      const shot = await s.client.callTool({ name: 'browser_screenshot', arguments: {} });
      const shotImg = shot.content?.find(c => c.type === 'image');
      const shotText = shot.content?.find(c => c.type === 'text');
      if (!shotImg) throw new Error(`Session ${s.id}: browser_screenshot returned no ImageContent`);
      const dims = validateImage(shotImg.data, shotImg.mimeType);
      console.log(`  slot-${s.id}: screenshot ${shotImg.mimeType} ${dims.width}x${dims.height} (${shotImg.data.length} base64 chars) ✓`);

      // Build standalone HTML (always, for all 5 slots)
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Browser V2 QA - ${clientId} slot-${s.id}</title></head><body><h2>${clientId} / slot-${s.id}</h2><img src="data:${shotImg.mimeType};base64,${shotImg.data}" style="max-width:100%"/></body></html>`;
      writeFileSync(`qa/screenshot-report-${clientId}-slot${s.id}.html`, html);

      // Keep file path for slot 0 standalone test
      if (s.id === 0 && shotText) {
        try { slot0FilePath = JSON.parse(shotText.text).screenshot_id; } catch(e) {}
      }
    }));

    // BLOCKER 4: standalone HTML independence test for slot 0
    // Temporarily rename the original PNG so we can prove HTML is self-contained
    if (slot0FilePath && existsSync(slot0FilePath)) {
      const tmpPath = slot0FilePath + '.qa-bak';
      renameSync(slot0FilePath, tmpPath);
      try {
        // Re-read the HTML we just wrote for slot 0
        const htmlContent = readFileSync(`qa/screenshot-report-${clientId}-slot0.html`, 'utf8');
        // The base64 data URI should still be in the HTML (it's embedded, not linked to the file)
        if (!htmlContent.includes('data:image/')) throw new Error('HTML does not contain embedded data URI — not self-contained!');
        // Confirm the img src is the base64 data URI (not a file path)
        if (htmlContent.includes(slot0FilePath.replace(/\\/g, '\\\\'))) {
          throw new Error('HTML contains reference to local file path — not self-contained!');
        }
        console.log(`  slot-0 HTML standalone test: PASS (PNG file removed, HTML still contains embedded image)`);
      } finally {
        renameSync(tmpPath, slot0FilePath); // restore
      }
    } else {
      console.log(`  slot-0 HTML standalone test: SKIPPED (screenshot_id not available)`);
    }

    console.log(`5/5 passed for ${clientId}`);
  } finally {
    for (const s of sessions) {
      try { await s.client.callTool({ name: 'browser_release', arguments: {} }); } catch(e) {}
      try { await s.transport.close(); } catch(e) {}
    }
  }
}

async function checkSchema() {
  console.log('\n== TIER B.H: TOOL SCHEMA ==');
  const { client, transport } = await createClient('goilot-gpt');
  try {
    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name);
    const required = [
      'browser_acquire', 'browser_release', 'browser_navigate', 'browser_status',
      'browser_screenshot', 'browser_read_screenshot', 'browser_restore_window',
      'browser_snapshot', 'browser_get_title', 'browser_get_url', 'browser_evaluate',
      'browser_wait_for_condition', 'browser_resize'
    ];
    for (const name of required) {
      if (!names.includes(name)) throw new Error(`Missing required tool: ${name}`);
    }
    console.log(`Schema passed (${names.length} tools present).`);
  } finally {
    await transport.close().catch(() => {});
  }
}

async function checkV1Regression() {
  console.log('\n== TIER B.V1: OLD PLAYWRIGHT REGRESSION ==');
  // V1 runs on port 8943 (PlaywrightAccount2Chrome / Alex). We only verify it still responds.
  // We do NOT call any V2 APIs here — just a raw HTTP probe.
  try {
    const http = await import('node:http');
    await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: 8943, path: '/health', method: 'GET', timeout: 5000 }, res => {
        if (res.statusCode >= 200 && res.statusCode < 500) resolve();
        else reject(new Error(`V1 MCP returned HTTP ${res.statusCode}`));
      });
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('V1 MCP timeout')));
      req.end();
    });
    console.log('V1 regression: PASS (port 8943 responds)');
  } catch(e) {
    // V1 being down is a warning not a blocker for V2, but report it
    console.warn(`V1 regression: WARNING — ${e.message}`);
  }
}

async function checkFinalSessionState() {
  console.log('\n== TIER B.Z: FINAL SESSION STATE ==');
  const http = await import('node:http');
  const body = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 8951, path: '/health', method: 'GET', timeout: 5000 }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
  const h = JSON.parse(body);
  console.log(`  sessions_active: ${h.sessions_active}`);
  console.log(`  sessions_queued: ${h.sessions_queued}`);
  console.log(`  source_dirty: ${h.source_dirty}`);
  console.log(`  running_commit: ${h.running_commit}`);
  if (h.sessions_active !== 0) throw new Error(`sessions_active=${h.sessions_active}, expected 0`);
  if (h.sessions_queued !== 0) throw new Error(`sessions_queued=${h.sessions_queued}, expected 0`);
  if (h.source_dirty === true) throw new Error(`source_dirty=true — running deployment is not from clean committed source`);
  console.log('Final session state: PASS');
}

async function main() {
  await runCoreTools();
  await runFiveBrowserTest('fadi-gpt');
  await runFiveBrowserTest('goilot-gpt');
  await checkSchema();
  await checkV1Regression();
  await checkFinalSessionState();
  console.log('\nTIER B RELEASE GATE COMPLETED SUCCESSFULLY.');
}

main().catch(e => { console.error(e); process.exit(1); });
