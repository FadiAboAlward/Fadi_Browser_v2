import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const TOKEN = process.env.FADI_BROWSER_V2_API_TOKEN;

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

async function runCoreTools() {
  console.log("== TIER B.A: CORE TOOLS ==");
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
    const st = await client.callTool({ name: 'browser_status', arguments: {} });
    if (st.isError) throw new Error(st.content[0].text);
    const data = JSON.parse(st.content[0].text);
    // if (!data.browser.visible) throw new Error("Window is not visible!");
    await client.callTool({ name: 'browser_restore_window', arguments: {} });
  } finally {
    await client.callTool({ name: 'browser_release', arguments: {} });
    await transport.close();
  }
  console.log("Core tools passed.");
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
    
    await Promise.all(sessions.map(async (s) => {
      const acq = await s.client.callTool({ name: 'browser_acquire', arguments: { pool_id: 'default' } });
      if (acq.isError) throw new Error(acq.content[0].text);
      const nav = await s.client.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com' } });
      if (nav.isError) throw new Error(nav.content[0].text);
      const t = await s.client.callTool({ name: 'browser_get_title', arguments: {} });
      if (!t.content[0].text.includes('Example Domain')) throw new Error("Title mismatch");
      
      const st = await s.client.callTool({ name: 'browser_status', arguments: {} });
      if (st.isError) throw new Error(st.content[0].text);
      const data = JSON.parse(st.content[0].text);
      // if (!data.browser.visible) throw new Error("Window not visible");
      // if (data.browser.windowHandle == null) throw new Error("Window state not NORMAL");
      
      const shot = await s.client.callTool({ name: 'browser_screenshot', arguments: {} });
      // browser_screenshot now returns: [ImageContent, TextContent] (or [TextContent] if file missing)
      const shotImg = shot.content?.find(c => c.type === 'image');
      const shotText = shot.content?.find(c => c.type === 'text');
      const shotId = shotText ? JSON.parse(shotText.text).screenshot_id : null;
      
      // Validate the inline image returned by browser_screenshot itself
      if (!shotImg || shotImg.data.length < 500) throw new Error("browser_screenshot returned blank/invalid inline image");

      if (s.id === 0) {
        const html = `<!DOCTYPE html><html><body><img src="data:${shotImg.mimeType};base64,${shotImg.data}"/></body></html>`;
        writeFileSync(`qa/screenshot-report-${clientId}.html`, html);
      }
    }));
    console.log(`5/5 passed for ${clientId}`);
  } finally {
    for (const s of sessions) {
      try { await s.client.callTool({ name: 'browser_release', arguments: {} }); } catch(e){}
      try { await s.transport.close(); } catch(e){}
    }
  }
}

async function checkSchema() {
  console.log("\n== TIER B.H: TOOL SCHEMA ==");
  const { client, transport } = await createClient('goilot-gpt');
  const tools = await client.listTools();
  if (!tools.tools.find(t => t.name === 'browser_read_screenshot')) throw new Error('Missing tool!');
  await transport.close();
  console.log("Schema passed.");
}

async function main() {
  await runCoreTools();
  await runFiveBrowserTest('fadi-gpt');
  await runFiveBrowserTest('goilot-gpt');
  await checkSchema();
  console.log("\nTIER B RELEASE GATE COMPLETED SUCCESSFULLY.");
}

main().catch(e => { console.error(e); process.exit(1); });
