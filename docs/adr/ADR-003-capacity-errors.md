# ADR-003: Return Structured Capacity Errors

- Status: Superseded by ADR-003-actionable-fifo-queue
- Date: 2026-09-21

## Context

When all five initial session slots are occupied, V2 may either queue requests or reject them explicitly. A durable queue adds cancellation, fairness, and caller-liveness semantics that are not required for the first reliable release.

## Decision

This immediate-rejection design was replaced before release. V2 now offers an explicit bounded strict-FIFO wait path and retains immediate `RESOURCE/CAPACITY_EXHAUSTED` only when the caller opts out of waiting.

The response includes active count, configured limit, and `queue_wait_ms: 0`. No session is stolen or reassigned.

## Consequences

See `ADR-003-actionable-fifo-queue.md` for the active decision, including cancellation, fairness, visible queue telemetry, and the prohibition on live lease theft.
