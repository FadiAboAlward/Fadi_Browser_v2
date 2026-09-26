import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { loadConfig } from '../src/config.mjs';

const config = loadConfig();
const token = process.env.FADI_BROWSER_V2_API_TOKEN;
if (!token) throw new Error('FADI_BROWSER_V2_API_TOKEN is required.');
const client = new Client({ name: 'fadi-browser-v2-qa', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(`http://${config.host}:${config.port}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${token}`, 'x-openai-session': 'smoke-test-session' } }
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map(tool => tool.name);
  for (const required of ['browser_acquire', 'browser_status', 'browser_release', 'browser_navigate', 'browser_snapshot']) {
    if (!names.includes(required)) throw new Error(`MCP tool missing: ${required}`);
  }
  const status = await client.callTool({ name: 'browser_status', arguments: {} });
  if (status.isError) throw new Error('browser_status returned an MCP error.');
  for (const tool of tools.tools.filter(item => item.name !== 'browser_acquire' && item.name !== 'browser_recover')) {
    const properties = tool.inputSchema?.properties || {};
    if ('lease_token' in properties || 'client_id' in properties) throw new Error(`${tool.name} exposes routine caller-held lease identity.`);
  }
  const readOnlyNames = ['browser_status', 'browser_snapshot', 'browser_get_url', 'browser_get_title'];
  for (const name of readOnlyNames) {
    const tool = tools.tools.find(item => item.name === name);
    if (tool?.annotations?.readOnlyHint !== true || tool?.annotations?.destructiveHint !== false) throw new Error(`${name} risk metadata is incorrect.`);
  }

  const acquired = parseToolJson(await client.callTool({ name: 'browser_acquire', arguments: { client_id: 'maintenance', wait: false, task_label: 'mcp-binding-qa' } }));
  if (acquired.lease_token) throw new Error('browser_acquire exposed a routine lease_token.');
  if (!acquired.recovery_credential) throw new Error('browser_acquire did not separate the recovery-only credential.');
  try {
    const navigated = await client.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com/#mcp-server-binding' } });
    if (navigated.isError) {
      console.error('Navigate error content:', navigated.content);
      throw new Error('Server-bound browser_navigate failed.');
    }
    const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: { compact: true, depth: 3 } });
    if (snapshot.isError) throw new Error('Server-bound browser_snapshot failed.');
    const ownedStatus = parseToolJson(await client.callTool({ name: 'browser_status', arguments: {} }));
    if (ownedStatus.status !== 'ACTIVE') throw new Error('Server-bound browser_status did not resolve the active lease.');
  } finally {
    await client.callTool({ name: 'browser_release', arguments: {} }).catch(() => {});
  }

  const freshClient = new Client({ name: 'fadi-browser-v2-fresh-chat-qa', version: '0.1.0' });
  const freshTransport = new StreamableHTTPClientTransport(new URL(`http://${config.host}:${config.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}`, 'x-openai-session': 'smoke-test-fresh' } }
  });
  try {
    await freshClient.connect(freshTransport);
    const freshResult = await freshClient.callTool({ name: 'browser_get_url', arguments: {} });
    if (!freshResult.isError) throw new Error('Fresh MCP task inherited another task lease.');
  } finally {
    await freshClient.close();
  }
  process.stdout.write(`${JSON.stringify({ status: 'PASS', server: client.getServerVersion(), tool_count: names.length, required_tools: true, server_side_binding: true, fresh_task_isolated: true, routine_lease_credential: false, risk_metadata: true }, null, 2)}\n`);
} finally {
  await client.close();
}

function parseToolJson(result) {
  const text = result?.content?.find(item => item.type === 'text')?.text;
  return JSON.parse(text || '{}');
}
