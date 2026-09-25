# MCP Interface Contract

## Design goal

Expose stable, simple task-oriented browser primitives while hiding browser-engine implementation details.

The V1 design lesson is explicit: normal browser actions should not require the model to retain and resend a credential-like lease token. Ownership should be resolved server-side whenever possible.

## Core broker tools

The implemented local endpoint is `http://127.0.0.1:8951/mcp`. A stdio adapter is available through `scripts/mcp-stdio.ps1`. Both enforce the same broker policy.

### browser_acquire

Purpose: allocate one isolated browser session for a task.

Expected inputs may include an optional requested auth profile, queue/wait preference, and bounded wait timeout.

Expected outputs:

- acquisition state: ACQUIRED / QUEUED / TIMEOUT / BUSY / ERROR;
- session status;
- selected auth profile alias when safe;
- queue position when queued;
- capability summary where useful.

The response includes a non-secret lease reference for diagnostics and may include a separately named `recovery_credential`. The recovery credential is used only by `browser_recover`; normal browser actions never accept it.

### browser_status

Returns health and ownership information safe for the caller.

Recommended fields:

- broker/engine health;
- active/queued session counts;
- caller's current session state;
- queue position and timeout if queued;
- browser executable;
- safe profile alias;
- process ID;
- window_state: NORMAL / MINIMIZED / MAXIMIZED / HIDDEN;
- visible: true/false;
- safe window identifier;
- active top-level title when safe.

It must not expose another client's secrets or private page content.

### browser_release

Explicitly releases the current task's owned transient session.

Preferred public form:

browser_release({})

The broker resolves ownership server-side from trusted caller/task context.

Release should be idempotent where practical.

### browser_recover

Only if safe persistent ownership recovery is implemented.

Recovery may use a dedicated opaque recovery credential or trusted ingress identity.

A recovery credential must not be required for ordinary navigation/click/snapshot/release calls.

### Actionable queue

At least one deterministic queue path must exist.

Either browser_acquire supports enqueue_when_busy and wait_timeout_seconds, or a dedicated browser_wait_for_lease/browser_queue_join action exists.

Requirements:

- bounded wait;
- FIFO by default;
- visible queue position;
- explicit timeout result;
- safe cancellation;
- no live healthy lease theft.

Implemented browser tools also include:

- `browser_navigate`;
- `browser_snapshot`;
- `browser_get_url`;
- `browser_get_title`;
- `browser_evaluate`;
- `browser_command` for an explicit allowlist of common agent-browser interactions.

Phase 1 QA capabilities (added in 0.2.0):

- `browser_screenshot` – capture a viewport or full-page screenshot;
- `browser_console_messages` – read console messages captured during the session;
- `browser_page_errors` – read JavaScript/page errors captured during the session;
- `browser_network_requests` – list network requests with sensitive data redacted;
- `browser_network_request_details` – retrieve full details of a specific request with sensitive data redacted;
- `browser_wait_for_condition` – wait for text, URL, load state, selector, or JS expression;
- `browser_resize` – resize the viewport for responsive layout testing.

After `browser_acquire`, all routine browser tools resolve ownership from the stateful MCP transport session. Their public schemas contain neither `client_id` nor `lease_token`.

The local HTTP operational API still uses `client_id` plus a lease credential because it is an administrative/script surface rather than the public model-facing MCP contract.

## Browser operations

Examples include navigate, snapshot, click, type, tabs, wait, evaluate where allowed, file upload, and window restore/foreground where supported.

Every operation after acquisition resolves to the exact internally owned session without a public credential-like lease argument.

MCP request cancellation aborts a queued acquire and records `queue_cancelled`. The HTTP operational surface also exposes an owner-validated queue cancellation route for script clients.

## Public handle fallback

If fully implicit server-side binding is technically impossible:

- expose a non-secret opaque task or lease handle;
- do not call it token/access_token/credential;
- do not rely on secrecy for authorization;
- validate ownership server-side;
- ensure platform metadata does not misrepresent it as an access token.

## Risk metadata

Audit tools individually.

Recommended semantic classes:

- read-only: status, snapshot, find, list/read operations, screenshot, console messages, page errors, network requests;
- local low-risk state change: resize, restore window, select tab, wait for condition;
- browser interaction: navigate, click, type, keypress;
- destructive/external write: only when the action can genuinely cause destructive external effects.

The objective is accurate metadata, not bypassing safeguards.

## Error model

Use structured categories rather than only free text:

- AUTH
- MFA
- NETWORK
- TIMEOUT
- CAPACITY
- QUEUE_TIMEOUT
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

Capacity exhaustion must be explicit and queue behavior must be actionable.

Do not retry ambiguous state-changing operations without idempotency evidence.

## Versioning

Expose broker version, browser-engine version, and MCP schema/interface version.

Breaking interface changes require documentation and a version bump.
