# AI Handoff Guide

This file lets a new AI agent take over the project without prior conversation context.

## New-agent checklist

1. Read AGENTS.md.
2. Read docs/IMPLEMENTATION_PLAYBOOK.md.
3. Read ARCHITECTURE.md.
4. Read project-manifest.yaml.
5. Read docs/V1_LESSONS_APPLIED.md.
6. Read relevant ADRs, especially lease binding, queue, auth persistence, and shared-pool decisions.
7. If runtime access exists, run status.
8. Run doctor.
9. Pull a sanitized report for the relevant period.
10. Inspect diagnostics if the task is incident-related.
11. Create a branch for non-trivial work.
12. Make the smallest safe change.
13. Run tests.
14. Run concurrency and reconnect regressions.
15. Compare benchmark for performance changes.
16. Update docs or ADR if behavior changed.
17. Open a PR.

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


## Production baseline

The production rollout completed on 25 Sep 2026.

Verified code baseline:

`1beadd42b7e964d54cc96853d4b920e644f2af85`

At activation time:

- five persistent pool slots were present;
- Fadi GPT, Goilot GPT, and Claude Desktop had real-client verification;
- authentication survived release/reacquire and restart;
- the post-deploy Example Domain and Sentry smoke test passed;
- release returned the pool to five FREE slots;
- final active and queued session counts were zero.

Do not reopen already-proven layers without regression evidence. If reproducing the system elsewhere, follow `docs/IMPLEMENTATION_PLAYBOOK.md` in order.
