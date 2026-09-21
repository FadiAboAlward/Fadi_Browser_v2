# ADR-003: Expose an Actionable Bounded FIFO Queue

- Status: Accepted
- Date: 2026-09-21

## Context

V1 demonstrated that reporting queue availability without giving the caller a usable queue path leaves unattended tasks stuck at the capacity boundary.

## Decision

When V2 reaches session capacity, the public MCP behavior must provide an actionable bounded queue.

Initial policy:

- FIFO ordering;
- explicit wait timeout;
- caller-visible queue position;
- safe cancellation;
- no stealing or reclaiming healthy live sessions to satisfy queued work.

The implementation may expose this through browser_acquire wait options or a dedicated queue/wait operation.

## Fairness

Initial global concurrency target: 5 sessions.

Per-client fairness or caps must be configurable so one client cannot monopolize the entire pool during shared use.

Initial recommendation: up to 3 active sessions per client until telemetry supports a different setting.

## Consequences

### Positive

- unattended tasks can survive temporary capacity pressure;
- no manual retry loop required;
- fairer multi-client operation;
- queue latency becomes measurable.

### Risks

- queue cancellation and timeouts must be race-safe;
- stale queue entries must be cleaned without affecting active leases.

## Required QA

- full capacity then queue;
- FIFO allocation;
- timeout behavior;
- cancellation;
- multiple clients;
- no live lease theft;
- queue status accuracy.
