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

## Implemented runtime topology

The 0.1.0 implementation uses a Node 24 broker bound to `127.0.0.1:8951`. It exposes a protected Streamable HTTP MCP endpoint at `/mcp` and a small protected local HTTP surface used by Windows operations and the stdio MCP adapter.

The broker invokes the repository-pinned `agent-browser` 0.38.1 CLI. Each lease receives a unique `--session` under the dedicated `fadi-browser-v2` namespace with strict tab pinning. No V1 port, process, profile, tunnel, task, or state directory is reused.

The HTTP operational API uses random 256-bit lease credentials whose SHA-256 hashes alone are stored. The public MCP surface binds that credential inside a stateful MCP transport session: routine tools expose neither `lease_token` nor `client_id`. Acquisition returns a separately named recovery-only credential for the explicit restart path. A fresh MCP task receives a distinct transport session and no inherited ownership.

Capacity uses a bounded strict-FIFO queue. A caller opts into a bounded wait on `browser_acquire`; MCP cancellation aborts the queued wait, and no later entry bypasses an ineligible head. Per-client caps and profile-bound serialization are enforced before promotion.

Portable auth uses the pinned engine's `restore-save=auto` known-good behavior with optional URL/text/function validation. Profile-bound auth requires a dedicated path under the V2 runtime auth directory and is serialized; it is never silently downgraded to cookie-only restore.

### Single external Chrome proof (`goilot`)

The `goilot` profile may opt into `externalChrome` with an installed Chrome executable and a dedicated loopback CDP port. V2 starts that Chrome with its existing V2-owned persistent user-data directory only when no process already owns that profile, verifies that the CDP listener belongs to that executable/profile, and attaches agent-browser to the current tab without navigating it. External sessions use a dedicated agent-browser namespace so a previous engine-owned browser in the ordinary namespace cannot be reused instead of the CDP target. The browser is a normal visible, interactive Windows process, not owned by the agent-browser daemon.

The broker still grants one exclusive lease for this profile. `browser_release` closes the agent-browser CDP session and frees the lease, but the externally owned Chrome window remains open with its profile state. A later acquire reattaches; if the user closed Chrome, V2 starts the installed executable with the same profile. A broker restart does not intentionally close this Chrome. No other client/profile mapping or pool policy changes in this one-browser proof.

The CDP port grants local browser control, so it must listen on loopback only and be used on a trusted local machine. V2 refuses a mismatched listener or another process already using the profile; it never starts a second Chrome against that live directory. It uses the native `connect <port>` operation and does not repeat `--headed` on externally attached commands: doing so can change agent-browser's launch configuration and silently replace the CDP target with an engine-owned browser. Before a lease becomes ACTIVE, V2 compares the session's CDP target IDs against the configured Chrome port and fails closed on a mismatch. Google and Sentry authentication persistence still require real-client verification and are not implied by this mechanism alone.

For the `goilot` identity, local configuration sets `authProfiles.goilot.headed: true`. The pinned engine receives its official `--headed` option for every command in that lease's session, so the browser opens on the interactive Windows desktop while retaining the same dedicated persistent profile path. Other auth profiles keep their existing launch mode. Release still closes the owned browser process and frees the pool slot; browser state remains in the profile for the next acquire. Visibility does not add a takeover, pause/resume, or shared-session coordination layer.

## Failure philosophy

Ownership and isolation failures are more severe than ordinary navigation failures.

Blocking examples include session crossover, tab ownership violation, auth identity mismatch, lease ambiguity, unsafe profile reuse, live lease theft to satisfy queue demand, or queue state that is advertised but not actually usable by the client.

## Observability boundary

Telemetry describes the browser infrastructure, not user page content.

Allowed examples include duration, operation name, error category, sanitized origin, resource usage, session lifecycle, queue state, window-state diagnostics, and ownership violations.

Disallowed examples include passwords, cookies, auth headers, OTPs, full private URLs, DOM content, and private screenshots by default.
