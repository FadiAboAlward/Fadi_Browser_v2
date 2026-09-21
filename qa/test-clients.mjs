import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawn } from 'child_process';
import path from 'path';

async function testClient(clientId, url) {
  console.log(`Testing ${clientId}...`);
  const ps1Path = path.resolve('scripts/mcp-stdio.ps1');
  
  const env = { ...process.env, FADI_BROWSER_V2_CLIENT_ID: clientId };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/mcp-stdio.mjs'],
    env
  });
  
  const client = new Client({ name: 'qa-client', version: '1.0' }, { capabilities: {} });
  await client.connect(transport);
  console.log(`[${clientId}] Connected to MCP.`);

  console.log(`[${clientId}] Acquiring lease...`);
  // Acquire
  const acquireResult = await client.callTool({
    name: 'browser_acquire',
    arguments: { client_id: clientId, wait: true }
  });
  if (acquireResult.isError) {
      console.error(`[${clientId}] Failed to acquire:`, acquireResult.content[0].text);
      process.exit(1);
  }
  console.log(`[${clientId}] Acquired:`, acquireResult.content[0].text);

  try {
    // Impersonation test
    if (clientId !== 'fadi-gpt') {
        const impResult = await client.callTool({
          name: 'browser_acquire',
          arguments: { client_id: 'fadi-gpt' }
        });
        if (impResult.isError && impResult.content[0].text.includes('Impersonation blocked')) {
            console.log(`[${clientId}] Impersonation correctly rejected.`);
        } else {
            console.error(`[${clientId}] Impersonation SUCCEEDED! This is a severe security failure. Result:`, JSON.stringify(impResult, null, 2));
            throw new Error('Impersonation test failed');
        }
    }

    // Navigate
    console.log(`[${clientId}] Navigating to ${url}...`);
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url }
    });

    // Snapshot
    console.log(`[${clientId}] Taking snapshot...`);
    const snapResult = await client.callTool({
      name: 'browser_snapshot',
      arguments: {}
    });
    // Check it returns something
    if (snapResult.content[0].text.length > 100) {
        console.log(`[${clientId}] Snapshot received (${snapResult.content[0].text.length} chars)`);
    } else {
        console.error(`[${clientId}] Snapshot too short!`);
    }
  } finally {
    // Release
    console.log(`[${clientId}] Releasing...`);
    await client.callTool({
      name: 'browser_release',
      arguments: {}
    });
    
    await transport.close();
    console.log(`[${clientId}] Done.\n`);
  }
}

async function main() {
  const tests = [
    testClient('fadi-gpt', 'https://example.com/1'),
    testClient('goilot-gpt', 'https://example.com/2'),
    testClient('goilot-claude', 'https://example.com/3')
  ];

  await Promise.all(tests);
  console.log('All concurrent tests passed!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
