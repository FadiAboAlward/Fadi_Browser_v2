# ADR-002: Node Broker and Pinned agent-browser Engine

- Status: Accepted
- Date: 2026-09-21

## Context

V2 needs a thin local broker, a standards-based MCP surface, durable SQLite telemetry, and an official browser engine. It must remain understandable and operable on Windows without rebuilding browser automation.

## Decision

- Use Node.js 24 or newer for the broker.
- Pin `agent-browser` exactly to `0.38.1`.
- Invoke the package-local official CLI; never use a floating global runtime dependency.
- Use a dedicated `fadi-browser-v2` agent-browser namespace and a unique session name per lease.
- Pin the MCP TypeScript SDK server and Node adapters to `2.0.0`.
- Use Node's local SQLite API and rotating JSONL for telemetry.
- Bind the HTTP/MCP service to `127.0.0.1:8951` by default.
- Require a DPAPI-protected local bearer credential for broker and MCP operations.
- Start at user logon with a limited-privilege scheduled task named `Fadi Browser V2`.

## Consequences

The broker stays small and delegates page automation to the official engine. Node 24 is a hard prerequisite. The local MCP endpoint is separate from agent-browser's own stdio MCP because V2 must enforce lease and auth policy before every browser operation.

Engine upgrades require a deliberate dependency change, QA, benchmark comparison, and release note.
