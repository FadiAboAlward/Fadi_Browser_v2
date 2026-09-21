# Decision Index

Architecture decisions belong in docs/adr/.

## Accepted

- ADR-001 — Run V2 side by side with V1.
- ADR-002 — Prefer server-side lease/task binding and avoid routine caller-held lease credentials.
- ADR-003 — Expose an actionable bounded FIFO queue when session capacity is full.
- ADR-004 — Distinguish portable auth identities from profile-bound identities.

## Decisions to record as implementation progresses

Create ADRs for:

- exact broker language and runtime;
- exact browser-engine version pin and upgrade policy;
- telemetry schema and storage migrations;
- auth-state encryption and key storage;
- Windows startup mechanism;
- exact per-client concurrency cap after benchmark evidence;
- recovery semantics if transport limitations require a dedicated recovery handle;
- VPS or remote deployment if ever adopted.
