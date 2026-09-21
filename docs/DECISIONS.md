# Decision Index

Architecture decisions belong in docs/adr/.

## Accepted

- ADR-001 — Run V2 side by side with V1.
- ADR-002 — Use a Node 24 broker with `agent-browser` 0.38.1 and MCP SDK 2.0.0.
- ADR-003 — Return a structured capacity error instead of maintaining a broker queue.
- ADR-004 — Use isolated task sessions with one encrypted persistence writer per auth profile.

## Decisions to record as implementation progresses

Create ADRs for future changes to:

- telemetry schema and storage migrations;
- recovery-token semantics beyond the current lease-token proof;
- VPS or remote deployment if ever adopted.
