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
