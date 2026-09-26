import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
async function main() {
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8933/mcp'));
  const client = new Client({ name: 'test', version: '1.0' }, { capabilities: {} });
  await client.connect(transport);
  const status = await client.callTool({ name: 'browser_status', arguments: {} });
  console.log(JSON.stringify(status, null, 2));
  await transport.close();
}
main().catch(console.error);
