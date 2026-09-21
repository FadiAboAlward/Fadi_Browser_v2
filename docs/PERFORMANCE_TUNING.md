# Performance Tuning

## Principle

Performance work must be evidence-driven.

## Baseline workload

At minimum benchmark:

- 1 active session;
- 3 concurrent sessions;
- 5 concurrent sessions.

Measure:

- broker startup latency;
- session creation latency;
- first navigation latency;
- snapshot or observation latency;
- queue wait;
- memory;
- CPU;
- release cleanup time;
- failure rate.

## Percentiles

Track P50 and P95 for high-frequency operations.

Average alone is insufficient because tail latency often determines whether an AI workflow feels unreliable.

## Regression workflow

When a user reports slowness:

1. identify version range;
2. compare 7 or 30 day telemetry;
3. identify which operation regressed;
4. compare concurrency and resource pressure;
5. reproduce with benchmark;
6. change one relevant factor;
7. rerun benchmark;
8. document before and after.

## Scaling concurrency

Do not raise the default concurrency just because the engine permits it.

Raise only after confirming:

- memory headroom;
- acceptable P95 latency;
- stable auth restore;
- no increased crash rate;
- no ownership violations.

## Optimization priorities

1. correctness and isolation;
2. reliability;
3. tail latency;
4. throughput;
5. convenience.

Never trade session isolation for speed.
