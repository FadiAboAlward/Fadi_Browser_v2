import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { writeFileSync, readFileSync } from 'node:fs';

const TOKEN = 'bdaa1be9c39d65b98bc52fe3ffd27660df5048ed8a6f378d9ebd5bd730e820f0';

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['src/mcp-stdio.mjs'],
    env: {
      ...process.env,
      FADI_BROWSER_V2_CLIENT_ID: 'fadi-gpt',
      FADI_BROWSER_V2_API_TOKEN: TOKEN
    }
  });
  
  const client = new Client({ name: 'qa-client', version: '1.0' }, { capabilities: {} });
  await client.connect(transport);
  console.log('Connected to MCP server.');
  
  const tools = await client.listTools();
  if (!tools.tools.find(t => t.name === 'browser_read_screenshot')) {
    throw new Error('browser_read_screenshot not found in tools list');
  }
  
  console.log('Acquiring browser...');
  const acq = await client.callTool({
    name: 'browser_acquire',
    arguments: { pool_id: 'default' }
  });
  
  try {
    console.log('Navigating...');
    await client.callTool({
      name: 'browser_navigate',
      arguments: { url: 'https://example.com' }
    });
    
    console.log('Taking screenshot...');
    const shotResult = await client.callTool({
      name: 'browser_screenshot',
      arguments: {}
    });
    
    const shotData = JSON.parse(shotResult.content[0].text);
    const screenshotId = shotData.screenshot_id;
    console.log('Got screenshot_id:', screenshotId);
    
    console.log('Reading screenshot via MCP...');
    const readResult = await client.callTool({
      name: 'browser_read_screenshot',
      arguments: { screenshot_id: screenshotId }
    });
    
    const imageContent = readResult.content.find(c => c.type === 'image');
    if (!imageContent) throw new Error('No image content returned');
    
    console.log('Successfully received ImageContent!');
    console.log(`MimeType: ${imageContent.mimeType}, Data length: ${imageContent.data.length}`);
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head><title>QA Screenshot Report</title></head>
    <body>
      <h1>Screenshot QA Report</h1>
      <p>This image was retrieved via browser_read_screenshot (base64):</p>
      <img src="data:${imageContent.mimeType};base64,${imageContent.data}" style="border:1px solid #ccc; max-width: 100%;" />
    </body>
    </html>
    `;
    
    const reportPath = 'C:\\Users\\Fadi\\AppData\\Local\\FadiBrowserV2\\qa\\screenshot-report.html';
    writeFileSync(reportPath, html);
    console.log('Saved report to:', reportPath);
    
  } finally {
    console.log('Releasing browser...');
    await client.callTool({ name: 'browser_release', arguments: {} }).catch(e => console.error(e.message));
    await transport.close();
  }
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});

