import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

async function main() {
  const transport = new StdioClientTransport({
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\Users\\Fadi\\OneDrive\\Documents\\GitHub\\Fadi_Browser_v2\\scripts\\mcp-stdio.ps1', '-ClientId', 'goilot-claude'],
    env: process.env
  });

  const client = new Client({ name: 'qa-auto-claude', version: '1.0' }, { capabilities: {} });
  await client.connect(transport);
  console.log('Connected to Goilot Claude stdio MCP server!');

  const acquire = await client.callTool({ name: 'browser_acquire', arguments: { preference: 'EDGE', task_label: 'Goilot Claude Verification', task_mode: 'interactive' } });
  console.log('Acquire result:', JSON.stringify(acquire, null, 2));

  const acquireText = acquire.content.find(item => item.type === 'text')?.text;

  try {
    console.log('Navigating to example.com...');
    await client.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com' } });
    console.log('Taking snapshot...');
    const snap = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    console.log('Snapshot keys:', Object.keys(JSON.parse(snap.content.find(item => item.type === 'text')?.text)));
  } finally {
    console.log('Releasing lease...');
    await client.callTool({ name: 'browser_release', arguments: {} });
  }

  await transport.close();
}

main().catch(console.error);

