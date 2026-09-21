# ADR-003: Return Structured Capacity Errors

- Status: Accepted
- Date: 2026-09-21

## Context

When all five initial session slots are occupied, V2 may either queue requests or reject them explicitly. A durable queue adds cancellation, fairness, and caller-liveness semantics that are not required for the first reliable release.

## Decision

V2 returns `RESOURCE/CAPACITY_EXHAUSTED` immediately when capacity is full.

The response includes active count, configured limit, and `queue_wait_ms: 0`. No session is stolen or reassigned.

## Consequences

The initial implementation is deterministic and fail-closed. Callers may retry with their own bounded policy. A future queue requires a new ADR and must preserve ownership, cancellation, and telemetry invariants.
