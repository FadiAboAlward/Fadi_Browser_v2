# ADR-002: Prefer Server-Side Lease Binding

- Status: Accepted
- Date: 2026-09-21

## Context

Fadi Playwright V1 showed that requiring the AI caller to retain and resend lease state on ordinary browser actions created unnecessary friction and tightly coupled browser ownership to model-held state.

## Decision

V2 will prefer server-side task-to-lease binding.

Normal browser actions should resolve the caller's owned session internally from trusted MCP ingress/session context.

Normal release should also resolve the active owned lease internally.

If the transport makes fully implicit binding impossible, V2 may expose a non-secret opaque task handle, but ownership must still be validated server-side and the handle must not function as a secret credential.

Recovery-specific state, if needed, should remain separate from ordinary browser calls.

## Consequences

### Positive

- less caller state to retain;
- lower risk of unnecessary approval friction;
- simpler normal tool schemas;
- less coupling between model context and broker ownership;
- easier explicit release.

### Risks

- reconnect behavior must be designed carefully;
- task identity must remain stable enough for safe server-side resolution;
- recovery paths need explicit ownership proof.

## Required QA

- same-chat flow;
- transport reconnect;
- fresh chat;
- concurrent clients;
- explicit release;
- restart/recovery;
- stale cleanup;
- hijack prevention.
