# ADR-004: Distinguish Portable and Profile-Bound Auth Identities

- Status: Accepted
- Date: 2026-09-21

## Context

Not every authenticated browser identity can be safely reconstructed from cookies/localStorage alone.

Current browser ecosystems increasingly use profile-bound or device-bound credentials for some providers. Upstream reports show that a cookie/state export can appear complete while the provider still treats the new session as signed out.

At the same time, sharing one live writable browser profile across concurrent browser processes creates profile-lock collisions and cross-session interference.

## Decision

V2 will classify each auth identity as one of two modes.

### Portable

The identity can be restored into an isolated task session from encrypted persisted state and passes a validation check.

Portable identities may support concurrent task sessions if isolation tests pass.

### Profile-bound

The identity requires a dedicated persistent browser profile/runtime identity.

A profile-bound identity must never be mounted writable by several concurrent browser processes.

If true concurrency for the same provider/account is not technically safe, V2 will serialize that identity rather than weakening isolation.

## Known-good generations

Persisted auth state should use generation semantics:

1. keep the current known-good state;
2. restore into an isolated session;
3. validate expected authenticated state;
4. save a new candidate generation;
5. promote only after validation;
6. retain the previous known-good generation for rollback.

## Consequences

### Positive

- avoids assuming cookies are sufficient for every provider;
- protects against silent auth corruption;
- avoids unsafe shared profile use;
- makes account-specific concurrency limits explicit.

### Trade-off

Some identities may allow fewer concurrent tasks than the global browser pool.

This is acceptable. Correct identity isolation has priority over maximum concurrency.

## Required QA

- portable identity restore validation;
- bad restore never overwrites known-good state;
- profile-bound identity rejects unsafe concurrent writable use;
- auth capability is visible in safe status/config metadata;
- no silent downgrade from profile-bound to cookie-only restore.
