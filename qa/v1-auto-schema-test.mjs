import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8933/mcp'));
  const client = new Client({ name: 'qa-auto', version: '1.0' }, { capabilities: {} });
  await client.connect(transport);

  const tools = await client.listTools();
  const be = tools.tools.find(t => t.name === 'browser_evaluate');
  console.log(JSON.stringify(be.inputSchema, null, 2));
  
  await transport.close();
}

main().catch(console.error);
