import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { asBrokerError } from './errors.mjs';

function resolveIdentity(boundContext, args) {
    if (args && args.session_ref) {
      if (!boundContext.clientId) throw new Error('No client context bound for session_ref. Call browser_acquire first.');
      return { clientId: boundContext.clientId, sessionRef: args.session_ref };
    }
  const clientId = boundContext.clientId;
  const leaseToken = boundContext.leaseToken;
  if (!clientId || !leaseToken) {
    throw new Error('No session is bound to this MCP task. Call browser_acquire first.');
  }
  return { clientId, leaseToken };
}

export function createBrokerMcpServer(backend, version = '0.1.0', preboundClientId = null, boundContext = { clientId: null, leaseToken: null }) {
  const server = new McpServer({
    name: 'fadi-browser-v2',
    version
  }, {
    capabilities: { tools: {} },
    instructions: 'Acquire an exclusive lease before browser operations. Once acquired, operations are bound to the session.'
  });

  const clientIdSchema = preboundClientId 
    ? z.string().optional() 
    : z.string().min(1);

  register(server, 'browser_acquire', 'Allocate one isolated browser session under local client/auth policy.', z.object({
    client_id: clientIdSchema,
    auth_profile_id: z.string().min(1).optional(),
    pool_id: z.string().min(1).optional(),
    task_label: z.string().max(80).optional(),
    wait: z.boolean().optional(),
    wait_timeout_ms: z.number().int().min(1000).max(300000).optional()
  }), async (args, extra) => {
    const actualClientId = preboundClientId || args.client_id;
    if (!actualClientId) throw new Error("client_id is required");
    if (preboundClientId && args.client_id && args.client_id !== preboundClientId) {
      throw new Error(`Impersonation blocked: MCP connection is pre-bound to client_id '${preboundClientId}'`);
    }

    const waitTimeoutMs = args.wait === false ? 0 : args.wait_timeout_ms;
    const result = await backend.acquire({ clientId: actualClientId, authProfileId: args.auth_profile_id, poolId: args.pool_id, taskLabel: args.task_label, waitTimeoutMs, signal: extra?.signal });
    boundContext.clientId = actualClientId;
    boundContext.leaseToken = result.lease_token;
    const { lease_token: recoveryCredential, ...publicResult } = result;
    return { ...publicResult, recovery_credential: recoveryCredential };
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });

  register(server, 'browser_status', 'Return broker health or the session bound to this MCP task.', z.object({ session_ref: z.string().optional() }), args => {
    return backend.status({ clientId: boundContext.clientId, leaseToken: boundContext.leaseToken });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_recover', 'Recover a restart-preserved lease only with its original credential.', z.object({
    client_id: clientIdSchema,
    recovery_credential: z.string().min(32)
  }), async args => {
    const actualClientId = preboundClientId || args.client_id;
    if (!actualClientId) throw new Error("client_id is required");
    if (preboundClientId && args.client_id && args.client_id !== preboundClientId) {
      throw new Error(`Impersonation blocked: MCP connection is pre-bound to client_id '${preboundClientId}'`);
    }

    const result = await backend.recover({ clientId: actualClientId, leaseToken: args.recovery_credential });
    boundContext.clientId = actualClientId;
    boundContext.leaseToken = args.recovery_credential;
    return result;
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_release', 'Release the session bound to this MCP task.', z.object({ session_ref: z.string().optional() }), async args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    const result = await backend.release({ clientId, leaseToken, sessionRef });
    if (boundContext.leaseToken === leaseToken) {
      boundContext.clientId = null;
      boundContext.leaseToken = null;
    }
    return result;
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_navigate', 'Navigate the bound session to an HTTP(S) URL.', z.object({ url: z.url() ,
    session_ref: z.string().optional()
  }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.navigate({ clientId, leaseToken, sessionRef, url: args.url });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });

  register(server, 'browser_snapshot', 'Return an accessibility snapshot from the owned session.', z.object({
    interactive: z.boolean().optional(),
    compact: z.boolean().optional(),
    depth: z.number().int().min(1).max(20).optional()
  ,
    session_ref: z.string().optional()
  }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.snapshot({ clientId, leaseToken, sessionRef, interactive: args.interactive, compact: args.compact, depth: args.depth });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_get_url', 'Return the current URL for the owned session.', z.object({ session_ref: z.string().optional() }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.getUrl({ clientId, leaseToken, sessionRef });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_get_title', 'Return the current title for the owned session.', z.object({ session_ref: z.string().optional() }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.getTitle({ clientId, leaseToken, sessionRef });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_evaluate', 'Evaluate JavaScript in the owned session. Scripts are never written to telemetry.', z.object({
    script: z.string().max(50000)
  ,
    session_ref: z.string().optional()
  }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.evaluate({ clientId, leaseToken, sessionRef, script: args.script });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });

  register(server, 'browser_command', 'Run an allowlisted agent-browser interaction in the owned session.', z.object({
    command: z.enum(['click', 'fill', 'type', 'press', 'wait', 'tab', 'back', 'forward', 'reload', 'hover', 'focus', 'check', 'uncheck', 'select', 'scroll', 'scrollintoview']),
    args: z.array(z.string().max(10000)).max(20).optional()
  ,
    session_ref: z.string().optional()
  }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.command({ clientId, leaseToken, sessionRef, command: args.command, args: args.args || [] });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });

  register(server, 'browser_restore_window', 'Restore and foreground the same interactive browser window without launching another browser.', z.object({ session_ref: z.string().optional() }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.restoreWindow({ clientId, leaseToken, sessionRef });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  // --- Phase 1 QA capabilities ---

  register(server, 'browser_screenshot', 'Capture a screenshot of the current page in the owned session. Returns the screenshot as inline base64 image content (for remote clients) plus normalized metadata.', z.object({
    full_page: z.boolean().optional(),
    session_ref: z.string().optional()
  }), async args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    const raw = await backend.screenshot({ clientId, leaseToken, sessionRef, fullPage: args.full_page });
    
    
    // Extract path from agent-browser output
    const filePath = raw?.output?.data?.path || raw?.output?.data?.file || raw?.path || raw?.file || null;
    
    let imageContent = null;
    let screenshotMeta = null;

    if (filePath && fs.existsSync(filePath)) {
      const imageBuffer = fs.readFileSync(filePath);
      const base64 = imageBuffer.toString('base64');
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      
      const sha256 = crypto.createHash('sha256').update(imageBuffer).digest('hex');
      
      let width = 0;
      let height = 0;
      if (imageBuffer.length > 24 && mimeType === 'image/png' && imageBuffer.toString('hex', 0, 4) === '89504e47') {
        width = imageBuffer.readUInt32BE(16);
        height = imageBuffer.readUInt32BE(20);
      }

      const screenshotId = `shot_${sha256.slice(0, 16)}`;
      
      // We will copy the file to a stable location named by screenshot_id so it can be retrieved later.
      const normalizedQaDir = path.join(process.env.LOCALAPPDATA || '', 'FadiBrowserV2', 'qa', 'screenshots');
      if (!fs.existsSync(normalizedQaDir)) fs.mkdirSync(normalizedQaDir, { recursive: true });
      const stablePath = path.join(normalizedQaDir, `${screenshotId}.png`);
      if (!fs.existsSync(stablePath)) {
        fs.copyFileSync(filePath, stablePath);
      }

      imageContent = { type: 'image', data: base64, mimeType };
      screenshotMeta = {
        id: screenshotId,
        mime_type: mimeType,
        width,
        height,
        byte_size: imageBuffer.length,
        sha256,
        local_path: stablePath,
        artifact_reference: `file:///${stablePath.replace(/\\/g, '/')}`
      };
    }
    
    const structuredResult = {
      ok: !!screenshotMeta,
      
      
      screenshot: screenshotMeta
    };
    
    const textContent = { type: 'text', text: JSON.stringify(structuredResult, null, 2) };
    return { 
      content: imageContent ? [imageContent, textContent] : [textContent],
      structuredContent: structuredResult
    };
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_screenshot_get', 'Retrieve a previously captured screenshot by ID. Returns the exact same image content and metadata without interacting with the browser.', z.object({
    screenshot_id: z.string().min(1),
    session_ref: z.string().optional()
  }), async args => {
    // Identity verification is optional here if the image is in the QA dir, but we can do it if session_ref is provided.
    if (args.session_ref || boundContext.clientId) {
       resolveIdentity(boundContext, args);
    }
    
    const normalizedQaDir = path.join(process.env.LOCALAPPDATA || '', 'FadiBrowserV2', 'qa', 'screenshots');
    const stablePath = path.join(normalizedQaDir, `${args.screenshot_id}.png`);
    
    if (!fs.existsSync(stablePath)) {
      throw new Error(`Screenshot not found or expired: ${args.screenshot_id}`);
    }

    const imageBuffer = fs.readFileSync(stablePath);
    const base64 = imageBuffer.toString('base64');
    const sha256 = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const mimeType = 'image/png';
    
    let width = 0, height = 0;
    if (imageBuffer.length > 24 && imageBuffer.toString('hex', 0, 4) === '89504e47') {
      width = imageBuffer.readUInt32BE(16);
      height = imageBuffer.readUInt32BE(20);
    }
    
    const screenshotMeta = {
      id: args.screenshot_id,
      mime_type: mimeType,
      width,
      height,
      byte_size: imageBuffer.length,
      sha256,
      local_path: stablePath,
      artifact_reference: `file:///${stablePath.replace(/\\/g, '/')}`
    };

    const structuredResult = { ok: true, screenshot: screenshotMeta };
    const textContent = { type: 'text', text: JSON.stringify(structuredResult, null, 2) };

    return {
      content: [{ type: 'image', data: base64, mimeType }, textContent],
      structuredContent: structuredResult
    };
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  
  // Legacy alias for backward compatibility
  register(server, 'browser_read_screenshot', 'Legacy alias for browser_screenshot_get', z.object({
    screenshot_id: z.string().min(1),
    session_ref: z.string().optional()
  }), async args => {
    // We will just try to read from the old temporary folder or the new stable folder
    const fallbackPath = path.isAbsolute(args.screenshot_id) ? args.screenshot_id : path.join(process.env.LOCALAPPDATA || '', 'FadiBrowserV2', 'qa', 'screenshots', `${args.screenshot_id}.png`);
    
    if (!fs.existsSync(fallbackPath)) {
      throw new Error(`Screenshot not found: ${args.screenshot_id}`);
    }
    const imageBuffer = fs.readFileSync(fallbackPath);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(fallbackPath).toLowerCase();
    return {
      content: [{ type: 'image', data: base64, mimeType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png' }],
      structuredContent: { ok: true, legacy_id: args.screenshot_id }
    };
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_console_messages', 'Return console messages captured during the owned session.', z.object({
    clear: z.boolean().optional()
  ,
    session_ref: z.string().optional()
  }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.consoleMessages({ clientId, leaseToken, sessionRef, clear: args.clear });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });

  register(server, 'browser_page_errors', 'Return JavaScript and page errors captured during the owned session.', z.object({
    clear: z.boolean().optional()
  ,
    session_ref: z.string().optional()
  }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.pageErrors({ clientId, leaseToken, sessionRef, clear: args.clear });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });

  register(server, 'browser_network_requests', 'Return a list of network requests captured during the owned session. Sensitive headers and credentials are redacted.', z.object({
    filter: z.string().max(500).optional(),
    type: z.string().max(100).optional(),
    method: z.string().max(10).optional(),
    status: z.string().max(20).optional()
  ,
    session_ref: z.string().optional()
  }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.networkRequests({ clientId, leaseToken, sessionRef, filter: args.filter, type: args.type, method: args.method, status: args.status });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_network_request_details', 'Return full details of a specific network request by ID. Sensitive headers and credentials are redacted.', z.object({
    request_id: z.string().min(1)
  ,
    session_ref: z.string().optional()
  }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.networkRequestDetail({ clientId, leaseToken, sessionRef, requestId: args.request_id });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_wait_for_condition', 'Wait for a condition in the owned session. Exactly one condition must be specified.', z.object({
    text: z.string().max(1000).optional(),
    text_gone: z.string().max(1000).optional(),
    url: z.string().max(2000).optional(),
    load_state: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
    fn: z.string().max(5000).optional(),
    selector: z.string().max(1000).optional(),
    timeout_ms: z.number().int().min(100).max(120000).optional()
  ,
    session_ref: z.string().optional()
  }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.waitForCondition({
      clientId, leaseToken,
      text: args.text, textGone: args.text_gone, url: args.url,
      loadState: args.load_state, fn: args.fn, selector: args.selector,
      timeoutMs: args.timeout_ms
    });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false });

  register(server, 'browser_resize', 'Resize the viewport of the owned session to test responsive layouts.', z.object({
    width: z.number().int().min(1).max(7680),
    height: z.number().int().min(1).max(4320)
  ,
    session_ref: z.string().optional()
  }), args => {
    const { clientId, leaseToken, sessionRef } = resolveIdentity(boundContext, args);
    return backend.resize({ clientId, leaseToken, sessionRef, width: args.width, height: args.height });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  return server;
}

function register(server, name, description, inputSchema, callback, annotations) {
  server.registerTool(name, { description, inputSchema, ...(annotations && { annotations }) }, async (args, extra) => {
    try {
      const result = await callback(args, extra);
      // If the callback already provided MCP-compliant content (e.g. ImageContent), use it
      if (result && Array.isArray(result.content)) {
        return {
          content: result.content,
          isError: result.isError,
          // Extract remaining keys as structuredContent if needed, minus the raw content array
          structuredContent: result.structuredContent || normalizeStructured({ ...result, content: undefined })
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: normalizeStructured(result)
      };
    } catch (error) {
      const failure = asBrokerError(error);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(failure.toJSON()) }] };
    }
  });
}

function normalizeStructured(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) return result;
  return { result };
}

