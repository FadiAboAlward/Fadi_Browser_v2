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
    L --> A
    A --> S
    S --> E
    E --> B1
    E --> B2
    E --> BN
    R --> A
    M --> T
    L --> T
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

The ownership contract for a task.

A lease should include at minimum:

- lease identifier or token;
- client identifier;
- auth profile identifier;
- session identifier once allocated;
- created_at;
- last_activity;
- status;
- expiry or recovery metadata if supported.

### Session

An isolated browser runtime used by one lease. Multiple sessions may originate from the same auth identity, but must not share an unsafe live profile lock or state directory.

## Session ownership invariant

For every browser operation, the lease must resolve to exactly one active owned session.

If ownership cannot be proven, fail closed.

## Identity invariant

A failure while using auth profile A must never cause automatic fallback to auth profile B.

## Concurrency model

Initial validated target: 5 active sessions.

The limit must be configurable. When full:

- queue safely; or
- fail with a structured capacity error.

Do not opportunistically steal another session.

## Recovery model

A broker restart must never create ambiguous ownership.

Recovery is allowed only when:

- the lease/session mapping was persisted safely;
- the caller proves the correct lease or recovery token;
- no competing owner exists.

Otherwise reclaim safely and require a new session.

## V1 relationship

V2 is intentionally side-by-side with the existing broker during evaluation.

No shared:

- profile directories;
- runtime state;
- ports;
- broker databases;
- log directories;
- service identifiers.

See ADR-001.

## Engine strategy

Use official browser-engine session, profile, and MCP capabilities whenever they satisfy the requirement.

Custom code should implement only what is necessary for:

- lease ownership;
- auth policy;
- client mapping;
- concurrency limits;
- lifecycle;
- telemetry;
- diagnostics.

## Failure philosophy

Ownership and isolation failures are more severe than ordinary navigation failures.

Examples that must be treated as blocking:

- session crossover;
- tab ownership violation;
- auth identity mismatch;
- lease ambiguity;
- unsafe profile reuse.

## Observability boundary

Telemetry describes the browser infrastructure, not user page content.

Allowed examples:

- duration;
- operation name;
- error category;
- sanitized origin;
- resource usage;
- session lifecycle.

Disallowed examples:

- passwords;
- cookies;
- auth headers;
- OTPs;
- full private URLs;
- DOM content;
- private screenshots by default.
