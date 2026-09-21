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
- V1 lessons-applied document mapping confirmed V1 issues to V2 requirements.
- ADR for server-side lease/task binding.
- ADR for an actionable bounded FIFO queue.
- ADR for portable vs profile-bound auth identity classification.
- Fresh-chat and reconnect ownership regression requirements.
- Window-state/browser-identity diagnostics requirements.
- Per-tool risk metadata audit requirements.
- Upstream open-source best practices research document.
- Upstream engine risk register.

### Changed

- Normal browser actions should avoid requiring a sensitive-looking public lease value.
- Queue behavior changed from optional/implementation-defined to required and actionable when capacity is full.
- Headful browser status requirements now include safe window-state diagnostics.
- QA now treats lease-related approval friction as a regression to prevent.
- Auth profiles now classified as portable or profile-bound.
- Per-client concurrency fairness cap added (initial recommendation: 3).

## Planned 0.1.0

Initial working V2 broker milestone:

- pinned browser engine version;
- separate MCP endpoint;
- dynamic server-bound lease and session allocation;
- actionable FIFO queue;
- multiple local auth identities;
- portable and profile-bound identity support;
- five-session concurrency QA;
- SQLite and JSONL telemetry;
- reports and diagnostics;
- V1 regression check.
