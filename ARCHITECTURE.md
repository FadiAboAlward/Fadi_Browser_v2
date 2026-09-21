# Architecture

## Objective

Provide a browser automation layer that scales from one task to several concurrent tasks without requiring a fixed browser assignment per AI client.

## System boundaries

### Public and versioned

- source code;
- tests;
- schemas;
- example configuration;
- docs;
- ADRs;
- benchmark definitions.

### Local and private

- actual client-to-auth mappings;
- auth state;
- cookies;
- OAuth tokens;
- encryption keys;
- local private endpoints;
- production logs;
- runtime databases.

## Logical architecture

~~~mermaid
flowchart TD
    C1[ChatGPT or MCP Client]
    C2[Claude or MCP Client]
    C3[Codex or MCP Client]
    M[Fadi Browser V2 MCP]
    P[Policy and Client Resolver]
    L[Lease Manager]
    Q[Bounded FIFO Queue]
    A[Auth Profile Resolver]
    S[Session Manager and Factory]
    E[Browser Engine]
    B1[Task Session A]
    B2[Task Session B]
    BN[Task Session N]
    T[(Telemetry SQLite and JSONL)]
    R[(Private Auth State)]

    C1 --> M
    C2 --> M
    C3 --> M
    M --> P
    P --> L
    L --> Q
    Q --> A
    L --> A
    A --> S
    S --> E
    E --> B1
    E --> B2
    E --> BN
    R --> A
    M --> T
    L --> T
    Q --> T
    S --> T
~~~

## Key entities

### Client

Represents the calling AI environment. A client may have a default allowed auth profile set, but client identity is not itself authentication.

### Auth Profile

Represents a persistent authenticated identity. Auth state is local and private.

Auth profiles expose health, not secrets:

- READY
- REAUTH_REQUIRED
- MFA_REQUIRED
- BROKEN
- UNKNOWN

### Lease

The internal ownership contract for a task.

A lease should include an internal lease identifier, client identifier, auth profile identifier, session identifier once allocated, timestamps, status, and recovery metadata if supported.

The lease is an internal broker concept. Normal MCP browser actions should not require the AI caller to resend a credential-like lease token.

### Public task binding

Preferred architecture:

- the broker binds the active lease to the trusted MCP ingress/session/task context;
- subsequent browser calls resolve the owned session server-side;
- browser_release resolves and releases the same internal ownership;
- transport reconnect or fresh-chat behavior must be explicitly tested.

If transport constraints make fully implicit binding impossible, the public value must be a non-secret opaque handle. It must not derive authorization from secrecy and should avoid credential-like names or metadata.

See ADR-002.

### Session

An isolated browser runtime used by one lease. Multiple sessions may originate from the same auth identity, but must not share an unsafe live profile lock or state directory.

## Session ownership invariant

For every browser operation, the trusted caller/task context must resolve to exactly one active owned session.

If ownership cannot be proven, fail closed.

## Identity invariant

A failure while using auth profile A must never cause automatic fallback to auth profile B.

## Concurrency and fairness model

Initial global validated target: 5 active sessions.

The limit must be configurable.

Shared-client deployments should also support a configurable per-client cap to prevent one client from starving the pool. Initial recommended shared-use cap: 3 active sessions per client until telemetry justifies a different value.

When capacity is full, the public surface must provide an actionable bounded queue rather than merely reporting that a queue exists.

Initial queue policy:

- FIFO;
- explicit wait timeout;
- visible queue position;
- safe cancellation;
- no stealing or reaping of live healthy owners.

See ADR-003.

## Recovery model

A broker restart must never create ambiguous ownership.

Recovery is allowed only when the lease/session mapping was persisted safely, the caller or trusted ingress proves the correct task ownership, and no competing owner exists.

A recovery credential, if required, should be separate from routine browser tool calls and used only for recovery.

Otherwise reclaim safely and require a new session.

## Browser operability diagnostics

For headful/interactive sessions, browser_status should expose safe operational identity so the user and agent can confirm which visible browser is controlled.

Recommended fields:

- executable;
- safe profile alias;
- process ID;
- OS window state;
- visibility;
- active top-level window title when safe;
- safe opaque window identifier;
- queue position and timeout when queued.

A restore/foreground operation may be exposed for interactive sessions, provided it restores the same browser and preserves login/profile state.

## MCP risk metadata

Tool annotations must match actual semantics.

Read-only operations remain read-only. Local window/tab-management actions should not automatically inherit destructive labels. External side-effecting actions must retain appropriate risk classification.

The goal is accurate metadata and lower unnecessary friction, not weaker safety.

## V1 relationship

V2 is intentionally side-by-side with the existing broker during evaluation.

No shared profile directories, runtime state, ports, broker databases, log directories, or service identifiers.

See ADR-001 and docs/V1_LESSONS_APPLIED.md.

## Engine strategy

Use official browser-engine session, profile, and MCP capabilities whenever they satisfy the requirement.

Custom code should implement only what is necessary for lease ownership, trusted task binding, auth policy, client mapping, concurrency and queueing, lifecycle, telemetry, and diagnostics.

## Failure philosophy

Ownership and isolation failures are more severe than ordinary navigation failures.

Blocking examples include session crossover, tab ownership violation, auth identity mismatch, lease ambiguity, unsafe profile reuse, live lease theft to satisfy queue demand, or queue state that is advertised but not actually usable by the client.

## Observability boundary

Telemetry describes the browser infrastructure, not user page content.

Allowed examples include duration, operation name, error category, sanitized origin, resource usage, session lifecycle, queue state, window-state diagnostics, and ownership violations.

Disallowed examples include passwords, cookies, auth headers, OTPs, full private URLs, DOM content, and private screenshots by default.
