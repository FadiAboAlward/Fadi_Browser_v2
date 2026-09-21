import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { loadConfig } from '../src/config.mjs';

const config = loadConfig();
const token = process.env.FADI_BROWSER_V2_API_TOKEN;
if (!token) throw new Error('FADI_BROWSER_V2_API_TOKEN is required.');
const client = new Client({ name: 'fadi-browser-v2-qa', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(new URL(`http://${config.host}:${config.port}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${token}` } }
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
  process.stdout.write(`${JSON.stringify({ status: 'PASS', server: client.getServerVersion(), tool_count: names.length, required_tools: true }, null, 2)}\n`);
} finally {
  await client.close();
}
