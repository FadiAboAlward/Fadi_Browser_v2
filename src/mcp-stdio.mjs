import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig } from './config.mjs';
import { BrokerApiClient } from './api-client.mjs';
import { createBrokerMcpServer } from './mcp.mjs';

const config = loadConfig();
const token = process.env.FADI_BROWSER_V2_API_TOKEN;
if (!token) {
  process.stderr.write('FADI_BROWSER_V2_API_TOKEN is required. Use scripts/mcp-stdio.ps1.\n');
  process.exit(1);
}
const backend = new BrokerApiClient(`http://${config.host}:${config.port}`, token);
const handle = serveStdio(() => createBrokerMcpServer(backend, '0.1.0'), {
  onerror: error => process.stderr.write(`MCP error: ${error.message}\n`)
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await handle.close();
    process.exit(0);
  });
}
