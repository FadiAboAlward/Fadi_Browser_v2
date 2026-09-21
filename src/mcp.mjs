import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { asBrokerError } from './errors.mjs';

const identitySchema = {
  client_id: z.string().min(1),
  lease_token: z.string().min(32)
};

export function createBrokerMcpServer(backend, version = '0.1.0') {
  const server = new McpServer({
    name: 'fadi-browser-v2',
    version
  }, {
    capabilities: { tools: {} },
    instructions: 'Acquire an exclusive lease before browser operations. Pass the same client_id and lease_token to every operation. Ownership ambiguity fails closed.'
  });

  register(server, 'browser_acquire', 'Allocate one isolated browser session under local client/auth policy.', z.object({
    client_id: z.string().min(1),
    auth_profile_id: z.string().min(1).optional(),
    task_label: z.string().max(80).optional()
  }), args => backend.acquire({ clientId: args.client_id, authProfileId: args.auth_profile_id, taskLabel: args.task_label }));

  register(server, 'browser_status', 'Return broker health or status for one owned lease.', z.object({
    client_id: z.string().min(1).optional(),
    lease_token: z.string().min(32).optional()
  }), args => backend.status({ clientId: args.client_id, leaseToken: args.lease_token }));

  register(server, 'browser_recover', 'Recover a restart-preserved lease only with its original credential.', z.object(identitySchema), args => backend.recover({ clientId: args.client_id, leaseToken: args.lease_token }));

  register(server, 'browser_release', 'Release the owned session and transient browser resources.', z.object(identitySchema), args => backend.release({ clientId: args.client_id, leaseToken: args.lease_token }));

  register(server, 'browser_navigate', 'Navigate the owned session to an HTTP(S) URL.', z.object({ ...identitySchema, url: z.url() }), args => backend.navigate({ clientId: args.client_id, leaseToken: args.lease_token, url: args.url }));

  register(server, 'browser_snapshot', 'Return an accessibility snapshot from the owned session.', z.object({
    ...identitySchema,
    interactive: z.boolean().optional(),
    compact: z.boolean().optional(),
    depth: z.number().int().min(1).max(20).optional()
  }), args => backend.snapshot({ clientId: args.client_id, leaseToken: args.lease_token, interactive: args.interactive, compact: args.compact, depth: args.depth }));

  register(server, 'browser_get_url', 'Return the current URL for the owned session.', z.object(identitySchema), args => backend.getUrl({ clientId: args.client_id, leaseToken: args.lease_token }));
  register(server, 'browser_get_title', 'Return the current title for the owned session.', z.object(identitySchema), args => backend.getTitle({ clientId: args.client_id, leaseToken: args.lease_token }));

  register(server, 'browser_evaluate', 'Evaluate JavaScript in the owned session. Scripts are never written to telemetry.', z.object({
    ...identitySchema,
    script: z.string().max(50000)
  }), args => backend.evaluate({ clientId: args.client_id, leaseToken: args.lease_token, script: args.script }));

  register(server, 'browser_command', 'Run an allowlisted agent-browser interaction in the owned session.', z.object({
    ...identitySchema,
    command: z.enum(['click', 'fill', 'type', 'press', 'wait', 'tab', 'back', 'forward', 'reload', 'hover', 'focus', 'check', 'uncheck', 'select', 'scroll', 'scrollintoview']),
    args: z.array(z.string().max(10000)).max(20).optional()
  }), args => backend.command({ clientId: args.client_id, leaseToken: args.lease_token, command: args.command, args: args.args || [] }));

  return server;
}

function register(server, name, description, inputSchema, callback) {
  server.registerTool(name, { description, inputSchema }, async args => {
    try {
      const result = await callback(args);
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
