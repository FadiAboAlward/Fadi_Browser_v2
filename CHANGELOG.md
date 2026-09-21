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
- V1 lessons-applied document mapping confirmed V1 issues to V2 requirements.
- ADR for server-side lease/task binding.
- ADR for an actionable bounded FIFO queue.
- Fresh-chat and reconnect ownership regression requirements.
- Window-state/browser-identity diagnostics requirements.
- Per-tool risk metadata audit requirements.

### Changed

- Normal browser actions should avoid requiring a sensitive-looking public lease value.
- Queue behavior changed from optional/implementation-defined to required and actionable when capacity is full.
- Headful browser status requirements now include safe window-state diagnostics.
- QA now treats lease-related approval friction as a regression to prevent.

## Planned 0.1.0

Initial working V2 broker milestone:

- pinned browser engine version;
- separate MCP endpoint;
- dynamic server-bound lease and session allocation;
- actionable FIFO queue;
- multiple local auth identities;
- five-session concurrency QA;
- SQLite and JSONL telemetry;
- reports and diagnostics;
- V1 regression check.
