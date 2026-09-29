import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFileSync } from 'node:fs';

const TOKEN = 'bdaa1be9c39d65b98bc52fe3ffd27660df5048ed8a6f378d9ebd5bd730e820f0';

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['src/mcp-stdio.mjs'],
    env: { ...process.env, FADI_BROWSER_V2_CLIENT_ID: 'fadi-gpt', FADI_BROWSER_V2_API_TOKEN: TOKEN }
  });
  
  const client = new Client({ name: 'regression', version: '1.0' }, { capabilities: {} });
  await client.connect(transport);
  
  console.log('Acquiring...');
  await client.callTool({ name: 'browser_acquire', arguments: { pool_id: 'default' } });
  
  try {
    console.log('Status:');
    const st = await client.callTool({ name: 'browser_status', arguments: {} });
    console.log(st.content[0].text.slice(0, 50));
    
    console.log('Navigate...');
    await client.callTool({ name: 'browser_navigate', arguments: { url: 'https://example.com' } });
    
    console.log('Get Title...');
    const t = await client.callTool({ name: 'browser_get_title', arguments: {} });
    console.log(t.content[0].text);
    
    console.log('Evaluate...');
    const e = await client.callTool({ name: 'browser_evaluate', arguments: { script: 'document.location.href' } });
    console.log(e.content[0].text);
    
    console.log('Command (hover)...');
    await client.callTool({ name: 'browser_command', arguments: { command: 'hover', args: ['h1'] } });
    console.log('Hover passed');
    
  } finally {
    await client.callTool({ name: 'browser_release', arguments: {} });
    await transport.close();
  }
}
main().catch(console.error);


