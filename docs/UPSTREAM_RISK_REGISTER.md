# Upstream Engine Risk Register

## Purpose

Track upstream risks that can affect Fadi Browser V2 even when our own broker code is correct.

This file is not a claim that every listed bug exists in our pinned version. Each item must be verified against the exact engine version used by V2.

## R1 — Shared profile lock / process collision

Observed across Playwright MCP, agent-browser, and Browser Use ecosystems.

Impact:

- sessions hijack each other;
- extra tabs;
- navigation timeout;
- launch failure.

Mitigation:

- never share one writable user-data directory across concurrent processes;
- test unique runtime paths;
- fail fast on path collision.

## R2 — Shared CDP context leaks cookies/tabs

Observed in agent-browser community reports when several sessions attach to one Chrome default context.

Impact:

- storage isolation failure;
- tab interference.

Mitigation:

- avoid shared default CDP context for independent agents;
- use isolated process/context ownership;
- treat tab pinning as UX only, not security.

## R3 — Device-bound authentication

Observed with current Google/Chrome authentication in upstream reports.

Impact:

- cookies/state restore may not recreate a valid login;
- OTP/login can recur unexpectedly.

Mitigation:

- classify identities as portable or profile-bound;
- allow serialized dedicated profile use when necessary;
- never promise arbitrary cloning of Google sessions.

## R4 — Windows-specific launch/runtime defects

Recent agent-browser upstream issues include Windows launch hangs, visible headless artifacts, and init-script navigation failures.

Impact:

- deployment may pass on another OS but fail locally.

Mitigation:

- Windows-native regression suite;
- canary engine upgrade;
- avoid untested optional features.

## R5 — Launch-config drift across commands/restarts

Upstream reports show profile/headed/config behavior can be lost or daemon restarted when launch-affecting values change.

Impact:

- silent logout;
- about:blank reset;
- unexpected daemon restart.

Mitigation:

- immutable launch config per session;
- persist and compare launch fingerprint;
- structured event on engine/session relaunch.

## R6 — Bad restore overwrites good auth

Generic persistence risk.

Impact:

- transient logout replaces the last valid auth state.

Mitigation:

- known-good auth generations;
- restore validation;
- atomic promote only after validation;
- rollback to prior auth generation.

## R7 — Long-running output/context growth

Browser agent community reports show performance degradation from repeated large DOM serialization and growing context.

Impact:

- increasing latency and token usage.

Mitigation:

- bounded snapshots;
- refs/delta snapshots;
- output caps;
- report metrics for response size and tool latency.

## R8 — Engine upgrade regression

agent-browser releases frequently and continues to receive bug reports.

Impact:

- new behavior breaks stable automation.

Mitigation:

- exact version pin;
- no automatic production upgrades;
- canary upgrade branch;
- full QA before promotion;
- one-click rollback to previous engine version.

## Review cadence

Review upstream engine releases/issues:

- before each engine upgrade;
- after any unexplained regression;
- at least monthly while V2 is actively evolving.

Record verified workarounds in ADRs, not only in this risk register.
