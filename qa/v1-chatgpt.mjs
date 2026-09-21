import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = process.env.FADI_BROWSER_V1_MCP_ENDPOINT || 'http://127.0.0.1:8933/mcp';
const client = new Client({ name: 'fadi-browser-v2-v1-regression', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(endpoint));
let leaseToken;
let browser;

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = new Set(listed.tools.map(tool => tool.name));
  for (const required of ['browser_acquire', 'browser_navigate', 'browser_snapshot', 'browser_release']) {
    if (!names.has(required)) throw new Error(`V1 MCP tool missing: ${required}`);
  }

  const acquired = parseToolJson(await client.callTool({
    name: 'browser_acquire',
    arguments: { preference: 'EDGE', task_label: 'Fadi Browser V2 regression QA', task_mode: 'interactive' }
  }));
  if (acquired.status !== 'ACQUIRED' || !acquired.lease_token) {
    throw new Error(`V1 lease was not acquired: ${acquired.status || 'unknown'}`);
  }
  leaseToken = acquired.lease_token;
  browser = acquired.browser;

  const nav = await client.callTool({
    name: 'browser_navigate',
    arguments: { url: 'https://platform.openai.com/settings/organization/tunnels', lease_token: leaseToken }
  });
  if (nav.isError) throw new Error('Navigate failed');
  await new Promise(resolve => setTimeout(resolve, 8000));

  await client.callTool({
    name: 'browser_click',
    arguments: { lease_token: leaseToken, text: 'Create tunnel' }
  });
  await new Promise(resolve => setTimeout(resolve, 5000));

  await client.callTool({
    name: 'browser_fill',
    arguments: { lease_token: leaseToken, text: 'Name', value: 'Fadi GPT V2 Tunnel' }
  });
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await client.callTool({
    name: 'browser_click',
    arguments: { lease_token: leaseToken, text: 'Save' } // Or whatever the submit button is
  });
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const snapshot = await client.callTool({
    name: 'browser_snapshot',
    arguments: { lease_token: leaseToken }
  });
  if (snapshot.isError) throw new Error('V1 browser_snapshot returned an MCP error.');
  const fs = await import('fs');
  fs.writeFileSync('snapshot.json', JSON.stringify(snapshot, null, 2));
  console.log('Snapshot saved to snapshot.json');

  const released = parseToolJson(await client.callTool({ name: 'browser_release', arguments: { lease_token: leaseToken } }));
  if (released.ok !== true || released.released !== true) throw new Error('V1 lease release was not confirmed.');
  leaseToken = undefined;
  process.stdout.write(`${JSON.stringify({ status: 'PASS', endpoint, browser, navigation: true, snapshot: true, lease_released: true }, null, 2)}\n`);
} finally {
  if (leaseToken) {
    try {
      await client.callTool({ name: 'browser_release', arguments: { lease_token: leaseToken } });
    } catch {}
  }
  await client.close().catch(() => {});
}

function parseToolJson(result) {
  if (result.isError) {
    console.error('V1 MCP tool error:', JSON.stringify(result, null, 2));
    throw new Error('V1 MCP tool returned an error.');
  }
  const text = result.content?.find(item => item.type === 'text')?.text;
  if (!text) throw new Error('V1 MCP tool returned no JSON text content.');
  return JSON.parse(text);
}
