# ADR-004: Isolated Sessions with a Single Persistence Writer

- Status: Accepted
- Date: 2026-09-21

## Context

An auth identity must survive restarts, while simultaneous browser processes must never share a live user-data directory or race while writing one state file.

## Decision

Use agent-browser encrypted restore state, not shared live Chrome profiles.

- Every lease receives a unique isolated agent-browser session.
- Persistent identities use a stable restore key inside the V2 namespace.
- The first active lease for an auth profile is the persistence writer.
- Additional simultaneous leases for that identity load the same baseline with `restore-save: never`.
- Public/non-authenticated sessions do not use restore state.
- The encryption key is generated locally, protected with Windows DPAPI CurrentUser, and injected only into the broker process environment.

## Consequences

Concurrent tasks are isolated and cannot corrupt a shared live profile. A single-writer session can persist legitimate cookie/local-storage refreshes. Changes made only by concurrent read-only copies are intentionally not merged into the durable identity; explicit merge semantics would require a new reviewed design.
