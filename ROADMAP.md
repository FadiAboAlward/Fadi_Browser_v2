# Roadmap

## Phase 0 — Documentation and isolation

- Public repository established.
- Architecture documented.
- Side-by-side boundary defined.
- Secret and logging rules defined.

## Phase 1 — Local V2 PoC

- Pin browser engine version.
- Implement thin broker.
- Add MCP interface.
- Add local runtime configuration.
- Validate one session.
- Validate five concurrent sessions.

## Phase 2 — Authentication identities

- Create multiple local auth profiles.
- Implement client-to-auth policy.
- Validate persistence across restart.
- Validate no silent identity fallback.
- Track auth health.

## Phase 3 — Observability

- SQLite event store.
- Rotating JSONL.
- 1, 7, 14, and 30 day reports.
- Sanitized diagnostic bundle.
- Resource-pressure events.
- Version-aware failure analysis.

## Phase 4 — Hardening

- crash and restart tests;
- stale lease cleanup;
- recovery semantics;
- load tests;
- long-running soak test;
- V1 regression suite.

## Phase 5 — Operational adoption

- Run V1 and V2 side by side.
- Compare reliability over real usage.
- Increase concurrency only after evidence.
- Decide whether or when V2 becomes default.

## Optional later phase — remote host

Move the same architecture to a VPS only if always-on browser access is worth the additional operational and security cost.
