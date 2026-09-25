import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { asBrokerError } from './errors.mjs';

function resolveIdentity(boundContext) {
  const clientId = boundContext.clientId;
  const leaseToken = boundContext.leaseToken;
  if (!clientId || !leaseToken) {
    throw new Error('No session is bound to this MCP task. Call browser_acquire first.');
  }
  return { clientId, leaseToken };
}

export function createBrokerMcpServer(backend, version = '0.1.0', preboundClientId = null) {
  const server = new McpServer({
    name: 'fadi-browser-v2',
    version
  }, {
    capabilities: { tools: {} },
    instructions: 'Acquire an exclusive lease before browser operations. Once acquired, operations are bound to the session.'
  });

  const boundContext = { clientId: null, leaseToken: null };

  const clientIdSchema = preboundClientId 
    ? z.string().optional() 
    : z.string().min(1);

  register(server, 'browser_acquire', 'Allocate one isolated browser session under local client/auth policy.', z.object({
    client_id: clientIdSchema,
    auth_profile_id: z.string().min(1).optional(),
    task_label: z.string().max(80).optional(),
    wait: z.boolean().optional(),
    wait_timeout_ms: z.number().int().min(1000).max(300000).optional()
  }), async (args, extra) => {
    const actualClientId = preboundClientId || args.client_id;
    if (!actualClientId) throw new Error("client_id is required");
    if (preboundClientId && args.client_id && args.client_id !== preboundClientId) {
      throw new Error(`Impersonation blocked: MCP connection is pre-bound to client_id '${preboundClientId}'`);
    }

    const waitTimeoutMs = args.wait === false ? 0 : (args.wait_timeout_ms || 30000);
    const result = await backend.acquire({ clientId: actualClientId, authProfileId: args.auth_profile_id, taskLabel: args.task_label, waitTimeoutMs, signal: extra?.signal });
    boundContext.clientId = actualClientId;
    boundContext.leaseToken = result.lease_token;
    const { lease_token: recoveryCredential, ...publicResult } = result;
    return { ...publicResult, recovery_credential: recoveryCredential };
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });

  register(server, 'browser_status', 'Return broker health or the session bound to this MCP task.', z.object({}), () => {
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

  register(server, 'browser_release', 'Release the session bound to this MCP task.', z.object({}), async () => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    const result = await backend.release({ clientId, leaseToken });
    if (boundContext.leaseToken === leaseToken) {
      boundContext.clientId = null;
      boundContext.leaseToken = null;
    }
    return result;
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_navigate', 'Navigate the bound session to an HTTP(S) URL.', z.object({ url: z.url() }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.navigate({ clientId, leaseToken, url: args.url });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });

  register(server, 'browser_snapshot', 'Return an accessibility snapshot from the owned session.', z.object({
    interactive: z.boolean().optional(),
    compact: z.boolean().optional(),
    depth: z.number().int().min(1).max(20).optional()
  }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.snapshot({ clientId, leaseToken, interactive: args.interactive, compact: args.compact, depth: args.depth });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_get_url', 'Return the current URL for the owned session.', z.object({}), () => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.getUrl({ clientId, leaseToken });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_get_title', 'Return the current title for the owned session.', z.object({}), () => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.getTitle({ clientId, leaseToken });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_evaluate', 'Evaluate JavaScript in the owned session. Scripts are never written to telemetry.', z.object({
    script: z.string().max(50000)
  }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.evaluate({ clientId, leaseToken, script: args.script });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });

  register(server, 'browser_command', 'Run an allowlisted agent-browser interaction in the owned session.', z.object({
    command: z.enum(['click', 'fill', 'type', 'press', 'wait', 'tab', 'back', 'forward', 'reload', 'hover', 'focus', 'check', 'uncheck', 'select', 'scroll', 'scrollintoview']),
    args: z.array(z.string().max(10000)).max(20).optional()
  }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.command({ clientId, leaseToken, command: args.command, args: args.args || [] });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });

  register(server, 'browser_restore_window', 'Restore and foreground the same interactive browser window without launching another browser.', z.object({}), () => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.restoreWindow({ clientId, leaseToken });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  // --- Phase 1 QA capabilities ---

  register(server, 'browser_screenshot', 'Capture a screenshot of the current page in the owned session.', z.object({
    full_page: z.boolean().optional()
  }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.screenshot({ clientId, leaseToken, fullPage: args.full_page });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_console_messages', 'Return console messages captured during the owned session.', z.object({
    clear: z.boolean().optional()
  }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.consoleMessages({ clientId, leaseToken, clear: args.clear });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_page_errors', 'Return JavaScript and page errors captured during the owned session.', z.object({
    clear: z.boolean().optional()
  }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.pageErrors({ clientId, leaseToken, clear: args.clear });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_network_requests', 'Return a list of network requests captured during the owned session. Sensitive headers and credentials are redacted.', z.object({
    filter: z.string().max(500).optional(),
    type: z.string().max(100).optional(),
    method: z.string().max(10).optional(),
    status: z.string().max(20).optional()
  }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.networkRequests({ clientId, leaseToken, filter: args.filter, type: args.type, method: args.method, status: args.status });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_network_request_details', 'Return full details of a specific network request by ID. Sensitive headers and credentials are redacted.', z.object({
    request_id: z.string().min(1)
  }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.networkRequestDetail({ clientId, leaseToken, requestId: args.request_id });
  }, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  register(server, 'browser_wait_for_condition', 'Wait for a condition in the owned session. Exactly one condition must be specified.', z.object({
    text: z.string().max(1000).optional(),
    text_gone: z.string().max(1000).optional(),
    url: z.string().max(2000).optional(),
    load_state: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
    fn: z.string().max(5000).optional(),
    selector: z.string().max(1000).optional(),
    timeout_ms: z.number().int().min(100).max(120000).optional()
  }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
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
  }), args => {
    const { clientId, leaseToken } = resolveIdentity(boundContext);
    return backend.resize({ clientId, leaseToken, width: args.width, height: args.height });
  }, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });

  return server;
}

function register(server, name, description, inputSchema, callback, annotations) {
  server.registerTool(name, { description, inputSchema, ...(annotations && { annotations }) }, async (args, extra) => {
    try {
      const result = await callback(args, extra);
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
