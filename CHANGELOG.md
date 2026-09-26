# Changelog

All notable project changes should be documented here.

## Unreleased

- Documentation now includes the production implementation playbook and final rollout lessons.

## 0.1.0 — 2026-09-25

Production Browser V2 rollout completed and verified.

- Added five persistent visible Chrome slots behind the shared broker pool.
- Decoupled client identity from browser-slot allocation.
- Verified release/reacquire and restart persistence for authenticated slots.
- Verified real-client paths for Fadi GPT, Goilot GPT, and Claude Desktop.
- Verified human interaction followed by AI continuation in the same visible browser.
- Verified five-slot concurrency, bounded queue behavior, independent release, and clean final state.
- Deployed approved commit `1beadd42b7e964d54cc96853d4b920e644f2af85` and passed the post-deploy Example Domain/Sentry smoke test.
- Confirmed V1 Edge can coexist functionally with V2; a separate legacy V1 Chrome worker issue was not caused by V2 and did not block release.

### Included work

- Added strict bounded FIFO queue promotion, cancellation, timeout telemetry, and per-client fairness enforcement.
- Bound routine MCP browser operations to stateful transport sessions and removed public routine lease/client arguments.
- Added portable versus profile-bound auth enforcement with engine known-good restore validation.
- Added safe browser window diagnostics/restore metadata and semantic MCP tool annotations.
- Added blocking working-tree QA, MCP binding/fresh-task regressions, and the complete V1-derived named regression suite.
- **Phase 1 QA capabilities**: Added `browser_screenshot`, `browser_console_messages`, `browser_page_errors`, `browser_network_requests`, `browser_network_request_details`, `browser_wait_for_condition`, and `browser_resize` — all backed by native `agent-browser` commands, with session isolation, server-side lease binding, and sensitive network data redaction.

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

## 0.1.0 milestone contents

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
