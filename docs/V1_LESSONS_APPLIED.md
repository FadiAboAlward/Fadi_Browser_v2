# V1 Lessons Applied to Fadi Browser V2

## Purpose

This document records confirmed operational lessons from Fadi Playwright V1 that must shape V2.

It is not a bug backlog for V1. It is a design-input document for V2 so future AI agents and maintainers do not repeat already observed problems.

## 1. Lease ownership should stay broker-side

Confirmed V1 lesson:

The V1 public tool surface required the caller to retain and resend a lease value on ordinary browser actions. That created unnecessary approval friction and coupled browser ownership to model-held state.

V2 requirement:

- Prefer broker-side binding of the current task to its lease and browser session.
- Normal browser actions should resolve the owned session internally.
- Normal release should not require a credential-like caller value.
- If transport constraints force a public handle, it must be non-secret, opaque, and ownership must still be validated server-side.
- Recovery-only data, if needed, should stay separate from normal browser actions.

Blocking QA:

- Same task can continue across normal calls without a caller-held secret.
- Fresh-chat and reconnect behavior is explicitly tested.
- No other task can hijack ownership.
- Explicit release still works deterministically.

## 2. Public schema must match real runtime behavior

Confirmed V1 lesson:

The tool schema and runtime behavior disagreed about whether lease state was optional.

V2 requirement:

- Public schemas must accurately describe what callers actually need.
- No hidden mandatory state.
- No misleading optional fields.
- Runtime errors must use structured categories.

## 3. Queue capability must be usable

Confirmed V1 lesson:

V1 could report that queueing existed while the public tool surface did not provide a deterministic way for a caller to join or wait.

V2 requirement:

- Queueing is part of the public behavior when capacity is full.
- Initial fairness policy is FIFO.
- Waiting is bounded by an explicit timeout.
- Queue position is visible to the current caller.
- Healthy live sessions are never stolen or reclaimed to satisfy queued work.
- Queue availability must never be advertised unless the caller can actually use it.

Shared-use fairness:

- Global initial concurrency target: 5.
- Per-client fairness/caps must be configurable.
- Initial shared-use recommendation: up to 3 active sessions per client until telemetry supports another value.

## 4. Browser identity and window state must be diagnosable

Confirmed V1 lesson:

A correctly controlled browser could appear to the user as if it were a different browser because the real window was minimized or off-screen.

V2 requirement for interactive/headful mode:

browser_status should expose safe operational diagnostics such as:

- browser executable;
- safe profile alias;
- process ID;
- window state: NORMAL / MINIMIZED / MAXIMIZED / HIDDEN;
- visibility;
- safe window identifier;
- active top-level title when safe.

Optional interactive operation:

- restore;
- foreground;
- maximize;
- minimize.

Restoring the window must not launch a duplicate browser or damage profile/login state.

## 5. Tool risk metadata must be accurate

Confirmed V1 lesson:

Routine browser actions were sometimes described with overly broad risk labels.

V2 requirement:

- Read-only tools remain clearly read-only.
- Local-only browser state changes are not automatically treated as destructive.
- Browser interactions are classified according to their real semantics.
- Externally destructive actions retain appropriate protections.

Goal:

Reduce unnecessary friction without weakening genuine safety controls.

## 6. Auto-release is not a substitute for deterministic release

Confirmed V1 lesson:

Idle-timeout cleanup can hide lifecycle friction but is not a correct replacement for explicit release.

V2 requirement:

- Keep deterministic explicit release.
- Retain stale/orphan cleanup as a safety net.
- Do not depend on timeout cleanup for normal task completion.

## 7. Reconnect and fresh-chat QA are mandatory

V2 must test ownership under:

- same chat, same transport;
- transport reconnect/refresh;
- fresh chat;
- several concurrent clients;
- broker restart and recovery;
- stale lease cleanup;
- long-running task;
- interactive idle timeout.

Pass condition:

Ownership remains correct and no routine caller-held secret is required.

## 8. Regression tests derived from V1

The implementation should include automated equivalents of:

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

## 9. Relationship to the V1 backlog

The V1 QA backlog remains the detailed historical source for confirmed V1 incidents.

This document intentionally translates those incidents into V2 design and QA requirements.

If a new V1 issue is confirmed and it reveals a reusable architectural lesson, update this file and the relevant V2 ADR/QA documentation.

## Status

These requirements are mandatory design inputs for V2 as of 21 Sep 2026.
