# MCP Interface Contract

## Design goal

Expose stable, simple task-oriented browser primitives while hiding browser-engine implementation details.

The V1 design lesson is explicit: normal browser actions should not require the model to retain and resend a credential-like lease token. Ownership should be resolved server-side whenever possible.

## Core broker tools

### browser_acquire

Purpose: allocate one isolated browser session for a task.

Expected inputs may include an optional requested auth profile, queue/wait preference, and bounded wait timeout.

Expected outputs:

- acquisition state: ACQUIRED / QUEUED / TIMEOUT / BUSY / ERROR;
- session status;
- selected auth profile alias when safe;
- queue position when queued;
- capability summary where useful.

The response may include a non-secret lease reference for diagnostics, but normal browser actions should not require it as a credential.

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

## Browser operations

Examples include navigate, snapshot, click, type, tabs, wait, evaluate where allowed, file upload, and window restore/foreground where supported.

Every operation after acquisition must resolve to the exact internally owned session, preferably without a public credential-like lease argument.

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

- read-only: status, snapshot, find, list/read operations;
- local low-risk state change: resize, restore window, select tab;
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
