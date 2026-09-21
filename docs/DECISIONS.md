# Decision Index

Architecture decisions belong in docs/adr/.

## Accepted

- ADR-001 — Run V2 side by side with V1.
- ADR-002 — Use a Node 24 broker with `agent-browser` 0.38.1 and MCP SDK 2.0.0; prefer server-side lease/task binding.
- ADR-003 — Expose an actionable bounded FIFO queue when capacity is full (replaces immediate structured error).
- ADR-004 — Distinguish portable auth identities from profile-bound identities; use isolated task sessions with encrypted persistence and known-good generations.

## Decisions to record as implementation progresses

Create ADRs for future changes to:

- telemetry schema and storage migrations;
- recovery-token semantics beyond the current lease-token proof;
- auth-state encryption and key storage;
- Windows startup mechanism;
- exact per-client concurrency cap after benchmark evidence;
- recovery semantics if transport limitations require a dedicated recovery handle;
- VPS or remote deployment if ever adopted.
