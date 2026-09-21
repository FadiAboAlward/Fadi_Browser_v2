# AI Handoff Guide

This file lets a new AI agent take over the project without prior conversation context.

## New-agent checklist

1. Read AGENTS.md.
2. Read ARCHITECTURE.md.
3. Read project-manifest.yaml.
4. Read docs/V1_LESSONS_APPLIED.md.
5. Read relevant ADRs, especially ADR-002 and ADR-003.
6. If runtime access exists, run status.
7. Run doctor.
8. Pull a sanitized report for the relevant period.
9. Inspect diagnostics if the task is incident-related.
10. Create a branch for non-trivial work.
11. Make the smallest safe change.
12. Run tests.
13. Run concurrency and reconnect regressions.
14. Compare benchmark for performance changes.
15. Update docs or ADR if behavior changed.
16. Open a PR.

## If the user says it is slow

Do not start by rewriting code.

Collect:

- version;
- last 7 or 30 day latency metrics;
- queue wait;
- concurrency;
- CPU and memory pressure;
- engine and broker restarts;
- operation-specific P50 and P95;
- baseline comparison.

Then isolate the bottleneck.

## If the user says it mixed browsers or accounts

Treat this as a high-severity isolation incident.

Collect:

- lease ownership;
- client_id;
- auth_profile_id;
- session_id;
- timeline of lifecycle events;
- tab or session ownership violation events.

Do not continue normal operations until ownership invariants are understood.

## If tasks stop when capacity is full

Check whether the public queue path is actually usable.

A status flag saying queueing exists is not enough. The caller must be able to join/wait with a bounded timeout and visible position.

Do not reclaim a healthy live session to satisfy queued work.

## If the user cannot tell which browser is controlled

Check browser/window diagnostics first.

Look for executable, profile alias, process ID, window state, visibility, and safe window identity before assuming the wrong browser was launched.

## If auth starts asking for MFA

Check auth-profile health and auth-restore telemetry.

Do not automatically switch to a different identity.

Do not delete the auth profile as a first troubleshooting step.

## If V2 fails entirely

V1 is intentionally independent and should remain available.

Do not modify V1 to compensate for a V2 bug.

## Public vs private data

The repo is public. Real identity mappings and auth state are local only.

Never paste real secret or config values into issues or PRs.

## Preferred output to the user

Lead with:

- current status;
- root cause and evidence;
- what changed;
- QA result;
- any truly unavoidable human action.

Avoid lengthy manual instructions if the agent can execute the change directly.
