# Changelog

All notable project changes should be documented here.

## Unreleased

### Added

- Initial public project documentation.
- AI-agent operating guide.
- Architecture and security model.
- Side-by-side migration decision.
- Auth-profile specification.
- Observability specification.
- Blocking QA strategy.
- Cross-agent handoff guidance.
- Node 24 lease broker with fail-closed client/auth/session ownership.
- Pinned `agent-browser` 0.38.1 integration and MCP SDK 2.0.0 server.
- Local Streamable HTTP and stdio MCP entry points.
- Configurable five-session limit with structured capacity errors.
- Encrypted auth restore using a single-writer policy.
- SQLite and rotating JSONL telemetry with 30-day retention.
- Windows install/start/stop/restart/status/doctor/report/diagnostics/QA/deploy/update/rollback/uninstall scripts.
- Exact-commit deployment with health smoke test and automatic rollback.
- Concurrency, policy, recovery, diagnostics, and secret-scan tests.

## Planned 0.1.0

Initial working V2 broker milestone:

- pinned browser engine version;
- separate MCP endpoint;
- dynamic lease and session allocation;
- multiple local auth identities;
- five-session concurrency QA;
- SQLite and JSONL telemetry;
- reports and diagnostics;
- V1 regression check.
