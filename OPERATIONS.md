# Operations

This document defines the intended operational experience. Exact script names may be implemented incrementally, but the public interface should remain simple.

## Desired commands

- start
- stop
- restart
- status
- doctor
- report
- diagnostics
- qa
- uninstall-v2

Windows-friendly PowerShell wrappers are preferred.

Implemented wrappers are under `scripts/`:

- `install.ps1`, `start.ps1`, `stop.ps1`, `restart.ps1`;
- `status.ps1`, `doctor.ps1`, `report.ps1`, `diagnostics.ps1`;
- `qa.ps1`, `benchmark.ps1`;
- `deploy.ps1`, `update.ps1`, `rollback.ps1`;
- `uninstall-v2.ps1`.

`uninstall-v2.ps1` preserves auth state by default. Removing it requires the explicit `-RemoveAuthState` switch.

## Start

Starting V2 should:

1. validate configuration;
2. verify no V1 port or state collision;
3. open telemetry storage;
4. start broker and MCP;
5. verify browser engine;
6. write a startup event with versions;
7. expose health status.

## Stop

Stopping should:

- stop accepting new leases;
- finish or safely terminate active work according to policy;
- release browser processes;
- flush telemetry;
- leave auth state intact;
- not affect V1.

## Status

Should return concise operational state:

- Broker: HEALTHY, DEGRADED, or DOWN
- MCP: HEALTHY, DEGRADED, or DOWN
- Browser engine: HEALTHY, DEGRADED, or DOWN
- active sessions
- queued sessions
- configured concurrency limit
- auth-profile health summary
- recent crash or restart
- resource pressure
- versions

## Doctor

Doctor should inspect configuration and environment without modifying production state unnecessarily.

Examples:

- engine installed;
- expected browser installed;
- runtime directories writable;
- telemetry database healthy;
- ports available;
- no V1 collision;
- MCP reachable;
- auth directory permissions reasonable;
- config schema valid.

## Reports

Reports should support 1, 7, 14, and 30 day windows and summarize:

- sessions;
- success and failure rate;
- peak concurrency;
- queue latency;
- operation latency;
- crashes;
- auth restore;
- MFA or reauth events;
- stale cleanup;
- top structured error categories.

## Diagnostics

Diagnostics should generate a sanitized bundle safe for an AI maintainer to inspect.

Never include secrets or auth state.

## Safe uninstall

Uninstall removes V2 only.

It must not delete:

- V1;
- unrelated Chrome or Edge profiles;
- unrelated Node tooling;
- unrelated Windows services or tasks;
- unrelated tunnels.

Auth-state deletion should be explicit and separately confirmed if the implementation treats it as valuable state.

## Explicit deployment

`deploy.ps1` fetches the approved commit, requires a clean repository, verifies that the commit is contained in `origin/main`, creates an immutable local deployment directory, installs exact dependencies, runs tests and secret scanning, switches the runtime pointer, starts V2, and performs a browser smoke test. Failure attempts rollback to the previous healthy deployment.


## Production shared-pool operating model

The production V2 pool uses five fixed persistent Chrome slots. Each slot has its own profile state and is exclusive while leased.

Operational expectations:

- Chrome remains visible and interactive.
- A user may complete OTP, MFA, CAPTCHA, verification, or account selection in the same window.
- The AI continues in that same browser afterward.
- Release frees logical AI ownership while preserving persistent authentication state.
- Normal release must not clear cookies or rebuild the profile.
- Do not run two Chrome processes against the same live user-data directory.

A healthy production idle state is:

- five slots FREE;
- zero active sessions;
- zero queued sessions.

## Production smoke test

After a deployment or runtime change:

1. confirm broker, MCP, and browser engine are healthy;
2. confirm five slots exist and the pool starts clean;
3. acquire from the default shared pool;
4. navigate to `https://example.com`;
5. verify `Example Domain` in the snapshot;
6. open a known authenticated service and verify persistence;
7. release;
8. verify the lease is CLOSED;
9. verify all five slots are FREE and active/queued counts are zero.

Do not treat an unrelated V1 worker outage as a V2 deployment failure without evidence of shared-resource regression.
