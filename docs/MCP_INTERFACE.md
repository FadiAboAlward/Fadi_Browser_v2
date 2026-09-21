# MCP Interface Contract

## Design goal

Expose stable, simple task-oriented browser primitives while hiding browser-engine implementation details.

## Core broker tools

The implemented local endpoint is `http://127.0.0.1:8951/mcp`. A stdio adapter is available through `scripts/mcp-stdio.ps1`. Both enforce the same broker policy.

### browser_acquire

Purpose: allocate one isolated browser session for a task.

Expected inputs:

- optional requested auth profile;
- task and client context if transport does not supply it.

Expected outputs:

- lease token;
- session status;
- selected auth profile alias;
- capability summary where useful.

### browser_status

Returns health and ownership information safe for the caller.

It must not expose another client's secrets or private page content.

### browser_release

Explicitly releases the current task lease and transient session.

Release should be idempotent where practical.

### browser_recover

Only if safe persistent ownership recovery is implemented.

Requires an opaque recovery or lease credential.

Implemented browser tools also include:

- `browser_navigate`;
- `browser_snapshot`;
- `browser_get_url`;
- `browser_get_title`;
- `browser_evaluate`;
- `browser_command` for an explicit allowlist of common agent-browser interactions.

All require both `client_id` and `lease_token`.

## Browser operations

Examples:

- navigate;
- snapshot;
- click;
- type;
- tabs;
- wait;
- evaluate where allowed;
- file upload.

Every operation after acquisition must bind to the exact lease.

## Error model

Use structured categories rather than only free text:

- AUTH
- MFA
- NETWORK
- TIMEOUT
- BROWSER_CRASH
- BROKER
- LEASE
- SESSION
- TAB_OWNERSHIP
- RESOURCE
- MCP_TRANSPORT
- AGENT_BROWSER
- CONFIG
- POLICY
- UNKNOWN

## Safety behavior

Ownership ambiguity fails closed.

Identity mismatch fails closed.

Capacity exhaustion must be explicit.

Do not retry ambiguous state-changing operations without idempotency evidence.

## Versioning

Expose:

- broker version;
- browser-engine version;
- MCP schema or interface version.

Breaking interface changes require documentation and a version bump.
