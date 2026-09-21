# ADR-004: Isolated Sessions with a Single Persistence Writer

- Status: Accepted
- Date: 2026-09-21

## Context

An auth identity must survive restarts, while simultaneous browser processes must never share a live user-data directory or race while writing one state file.

## Decision

Use agent-browser encrypted restore state, not shared live Chrome profiles.

- Every lease receives a unique isolated agent-browser session.
- Persistent identities use a stable restore key inside the V2 namespace.
- The first active lease for a portable auth profile is the persistence writer and uses the engine's `restore-save=auto` known-good policy.
- Additional simultaneous leases for that identity load the same baseline with `restore-save: never`.
- Optional URL, text, or function validation is passed to the engine; failed restore/validation cannot overwrite the previous known-good state.
- Profile-bound identities use a dedicated V2-owned browser profile path and are serialized instead of using portable restore state.
- Public/non-authenticated sessions do not use restore state.
- The encryption key is generated locally, protected with Windows DPAPI CurrentUser, and injected only into the broker process environment.

## Consequences

Concurrent tasks are isolated and cannot corrupt a shared live profile. A single-writer session can persist legitimate cookie/local-storage refreshes. Changes made only by concurrent read-only copies are intentionally not merged into the durable identity; explicit merge semantics would require a new reviewed design.
