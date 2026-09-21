# QA Strategy

## Principle

A successful process start is not a successful system.

V2 must explicitly prove that it does not repeat confirmed V1 failure modes.

## Blocking acceptance tests

### 1. Basic

Acquire, open a harmless page, verify URL/title/heading, then release.

### 2. Five concurrent sessions

Create five sessions simultaneously, each with a unique URL or anchor.

Verify correct final URL per session, no tab stealing, no session crossover, distinct ownership, and no identity mismatch.

### 3. Parallel operations

Run navigation and snapshot operations concurrently.

### 4. Release and reuse

Release all sessions, verify cleanup, allocate new ones.

### 5. Crash and restart

Safely simulate V2 broker or engine failure and verify no cross-session reassignment, correct cleanup/recovery, telemetry, and V1 unaffected.

### 6. Persistence

Use non-sensitive test auth state where possible and verify save/restore across restart.

### 7. Auth-policy isolation

Prove a client cannot silently receive a disallowed auth profile.

### 8. Telemetry

Verify events and metrics are emitted without secrets.

### 9. Sanitized diagnostics

Generate a bundle and inspect for secret leakage.

### 10. V1 regression

Run a harmless V1 test after V2 work. V1 must remain healthy and unchanged.

### 11. No sensitive-looking public lease value in normal actions

Run acquire -> tabs -> navigate -> snapshot -> click -> release.

Verify normal operations do not require the model to resend a lease value that behaves like a credential.

If a public handle is unavoidable, verify it is non-secret and ownership is still checked server-side.

Repeat at least five times.

### 12. Fresh-chat and transport-refresh ownership

Test:

- same chat, same transport;
- same chat after reconnect/refresh;
- fresh chat;
- multiple concurrent chats/clients;
- broker restart and safe recovery;
- stale cleanup;
- long-running lease;
- interactive idle timeout.

Pass condition: ownership remains correct without requiring a routine caller-held secret.

### 13. Actionable queue

Fill all available session capacity.

Then verify:

- a new caller can join the queue;
- queue position is visible;
- wait timeout is explicit;
- FIFO ordering works;
- no manual user retry is required;
- live healthy leases are not stolen or reclaimed;
- queue availability is only advertised when the caller can actually use it.

### 14. Per-client fairness

With multiple clients, verify configurable fairness/caps and confirm one client cannot monopolize all capacity when fairness policy is enabled.

### 15. Window-state diagnostics

For interactive/headful mode:

- verify status reports the real window state;
- restore returns the same browser;
- no duplicate browser/profile launches;
- tabs and login state remain intact.

### 16. Tool risk metadata audit

Verify:

- read-only operations are marked read-only;
- low-risk local browser actions are not mislabeled destructive without justification;
- external side-effecting actions retain appropriate classifications.

### 17. Authorized-flow permission regression

With normal host/plugin permissions enabled, run the normal acquire-to-release flow and verify no unnecessary approval appears solely because of lease lifecycle design.

## Required regression test names

1. acquire_returns_single_active_lease
2. same_task_actions_resolve_server_side_lease
3. no_public_credential_needed_for_browser_action
4. release_without_unnecessary_prompt
5. transport_refresh_retains_task_ownership
6. other_session_cannot_hijack_lease
7. stale_lease_reap_is_safe
8. broker_restart_recover_validates_ingress
9. concurrent_sessions_remain_isolated
10. interactive_window_restore_preserves_profile
11. normal_browser_actions_have_correct_risk_metadata
12. authorized_flow_has_zero_unnecessary_lease_prompts
13. busy_capacity_exposes_actionable_queue
14. queue_timeout_is_unambiguous
15. fifo_queue_never_steals_live_lease

## Soak test

Before calling V2 stable, run real or synthetic work over multiple days and review failures, crash count, auth restore, resource pressure, ownership violations, queue behavior, permission friction, and latency trend.

## Release blocking failures

Any of these blocks production readiness:

- session crossover;
- tab ownership violation;
- auth identity fallback;
- routine browser actions require a sensitive-looking public lease value without proven necessity;
- advertised but unusable queue;
- secret leakage;
- V1 regression;
- unrecoverable profile corruption;
- unreliable lease ownership.
