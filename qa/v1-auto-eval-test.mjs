import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8933/mcp'));
  const client = new Client({ name: 'qa-auto', version: '1.0' }, { capabilities: {} });
  await client.connect(transport);

  const acquire = await client.callTool({ name: 'browser_acquire', arguments: { preference: 'EDGE', task_label: 'Fadi Browser V2 Tunnel Eval', task_mode: 'interactive' } });
  const acquireText = acquire.content.find(item => item.type === 'text')?.text;
  const leaseToken = acquireText ? JSON.parse(acquireText).lease_token : null;

  try {
    let res = await client.callTool({ name: 'browser_evaluate', arguments: { code: 'return await page.title();', lease_token: leaseToken } });
    console.log(res.content.find(c => c.type === 'text')?.text);
  } finally {
    await client.callTool({ name: 'browser_release', arguments: { lease_token: leaseToken } });
    await transport.close();
  }
}

main().catch(console.error);
