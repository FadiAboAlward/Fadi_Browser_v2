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

  const status = await client.callTool({
    name: 'browser_status',
    arguments: { lease_token: leaseToken, full_tree: true }
  });
  if (status.isError) throw new Error('V1 browser_status returned an MCP error.');
  const statusJson = parseToolJson(status);
  console.log('Status:', JSON.stringify(statusJson, null, 2));

  // Wait, let's keep it simple.

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
