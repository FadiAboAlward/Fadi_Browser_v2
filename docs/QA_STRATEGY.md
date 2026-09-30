# QA Strategy

## Principle

A successful process start is not a successful system.

V2 must explicitly prove that it does not repeat confirmed V1 failure modes.

The QA system must also be **cost-aware**: exhaustive end-to-end testing after every tiny edit wastes time and agent credits. The repository therefore uses a layered release-gate model so cheap checks run frequently and expensive checks run only when they can change a release decision.

## QA ownership

The responsibilities are intentionally split:

- **Antigravity / local implementation agent**: implement changes, run the automated local test suites, diagnose failures, and produce machine-readable evidence.
- **GitHub / CI**: run deterministic repository checks such as unit tests, config/schema validation, static checks, and other tests that do not require the real Windows desktop/browser environment.
- **Independent ChatGPT QA**: verify a small set of critical real-user paths through the actual Fadi and Alex/Goilot ChatGPT integrations. This is an acceptance layer, not a duplicate of every local test.

No single layer may claim overall release readiness by itself.

## Credit-efficient layered gates

### Tier A — Fast change gate

Run after ordinary code/config changes.

Purpose: catch obvious regressions quickly without paying the cost of the full environment matrix.

Run only the tests relevant to the touched area, plus a minimal smoke sequence:

- service/broker health;
- acquire;
- harmless navigation;
- title/URL or snapshot verification;
- release;
- final zero active/queued sessions;
- focused unit/integration tests for changed modules.

Use fail-fast behavior when a clear blocker is found.

A Tier A pass means only that the change is ready for broader testing. It does **not** mean V2 is release-ready.

### Tier B — Full Browser V2 Release Gate

Run when any of the following is true:

- a broker, pool, concurrency, profile, lease, persistence, MCP-schema, screenshot, tunnel, window-state, queue, auth-policy, or lifecycle behavior changes;
- a previous full-gate failure is fixed;
- before calling a build stable;
- before a production deployment;
- before a cleanup that removes legacy MCP/plugin/tunnel objects.

This gate runs the full blocking acceptance suite in this document.

The expensive five-browser matrix, screenshot-report pipeline, window-interactivity checks, restart/recovery checks, and both client-policy checks belong here.

A substantial change is not complete until this gate passes.

### Tier C — Independent remote acceptance

After Tier B passes, verify the real external user paths:

- **Fadi Personal ChatGPT → Browser V2**;
- **Alex_Workspace / Goilot GPT → Browser V2**.

Do not repeat every local test manually. Verify the critical integration points that local tests cannot prove by themselves:

- current tool schema is visible after refresh/new chat;
- acquire/navigation works through the real tunnel/plugin path;
- five-slot access is exposed as intended when relevant;
- screenshot retrieval returns actual ImageContent when relevant;
- release works;
- final broker status is clean.

If Tier C exposes a failure, fix it and return to the appropriate earlier tier.

## Stable-release rule

Do not call Browser V2 stable unless:

1. the change-specific Tier A checks pass;
2. the full Tier B Release Gate passes;
3. Fadi Tier C remote acceptance passes;
4. Alex/Goilot Tier C remote acceptance passes;
5. the final broker state is clean;
6. the full Tier B gate passes **twice consecutively without a code/config change between the two runs** before the initial stable declaration.

In short:

**change PASS + full regression PASS + Fadi remote PASS + Alex remote PASS = release PASS**

A feature-specific PASS is never enough to claim overall readiness.

## Credit/time control

To avoid unnecessary Antigravity credit burn:

- do not run the full five-browser suite after every exploratory edit;
- use Tier A while iterating on a known defect;
- once the defect-specific tests pass, run Tier B once;
- if Tier B finds another regression, fix it, use focused Tier A checks, then rerun Tier B;
- run the second consecutive Tier B pass only when no further changes are planned and the build is a stability candidate;
- keep independent ChatGPT verification focused on real integration boundaries instead of duplicating the entire local suite;
- preserve reusable QA scripts in the repository rather than regenerating one-off scripts in each session;
- prefer machine-readable PASS/FAIL summaries and saved artifacts over long conversational traces.

The goal is to spend credits on evidence, not repeated narration.

## Blocking acceptance tests

### 1. Basic

Acquire, open a harmless page, verify URL/title/heading, then release.

### 2. Five concurrent sessions

Create five sessions simultaneously, each with a unique URL or anchor.

Verify:

- exactly five simultaneous active sessions;
- browser-1 through browser-5 are all ACTIVE at the same time;
- correct final URL per session;
- no tab stealing;
- no session crossover;
- distinct ownership;
- no identity mismatch;
- all five release cleanly;
- final status returns to zero active/queued and all five FREE.

Run this against both real client policies used by Fadi and Alex/Goilot when client-policy or pool behavior is in scope.

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

### 15. Window-state diagnostics and interactivity

For interactive/headful production pool sessions:

- verify status reports the real window state;
- `visible=true` when the contract requires an interactive visible browser;
- restore/foreground succeeds for the same browser;
- no `WINDOW_NOT_INTERACTIVE` is accepted for a pool that is supposed to be interactive;
- no duplicate browser/profile launches;
- tabs and login state remain intact.

### 16. Screenshot integrity and reporting

For every production pool slot when screenshot behavior is in scope:

- `browser_screenshot` succeeds;
- the image is non-empty and has non-zero dimensions;
- no blank screenshot is accepted;
- `browser_read_screenshot` returns actual ImageContent;
- MIME type and data are valid;
- a self-contained HTML report can embed the returned image data;
- the HTML still renders after the original local screenshot file is temporarily unavailable.

A local Windows path alone is not proof that the remote/reporting pipeline works.

### 17. Navigation reliability

Exercise real navigation across the five-slot pool and record timeout/failure rate.

Intermittent transport or OS errors such as socket timeout 10060 must be investigated if they appear under normal stable-load conditions. A single successful retry does not erase a repeatable reliability defect.

### 18. Tool risk metadata audit

Verify:

- read-only operations are marked read-only;
- low-risk local browser actions are not mislabeled destructive without justification;
- external side-effecting actions retain appropriate classifications.

### 19. Authorized-flow permission regression

With normal host/plugin permissions enabled, run the normal acquire-to-release flow and verify no unnecessary approval appears solely because of lease lifecycle design.

### 20. Tool-schema parity across real clients

For Fadi and Alex/Goilot, compare the intended public Browser V2 tool surface against what a fresh real ChatGPT conversation can actually see.

New or changed MCP tools are not considered deployed merely because local `listTools` sees them.

Refresh/reconnect the real plugin/tool schema when required, then verify in a fresh chat.

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
16. five_pool_slots_are_simultaneously_functional
17. all_pool_screenshots_are_non_blank
18. screenshot_imagecontent_is_remote_consumable
19. self_contained_html_does_not_depend_on_local_png
20. fadi_and_goilot_tool_schema_match_expected_surface

## Current regression blockers to keep covered

These defects have been observed during Browser V2 stabilization and must remain protected by regression tests:

- a configured five-slot pool behaving as only three usable sessions;
- production sessions returning `visible=false` / `WINDOW_NOT_INTERACTIVE`;
- an individual slot producing a blank screenshot;
- intermittent navigation/socket timeout behavior such as OS error 10060;
- screenshot capture succeeding while remote/report consumers receive only a local Windows file path;
- a newly implemented MCP tool existing locally but remaining absent from the real ChatGPT plugin schema until tools are refreshed.

## Soak test

Before calling V2 stable, run real or synthetic work over multiple days and review failures, crash count, auth restore, resource pressure, ownership violations, queue behavior, permission friction, screenshot integrity, window visibility, and latency trend.

The soak test is a release-confidence activity, not something to rerun after every small edit.

## Release blocking failures

Any of these blocks production readiness:

- session crossover;
- tab ownership violation;
- auth identity fallback;
- fewer than the required five simultaneous functional pool sessions;
- an interactive production slot that is not actually visible/interactive;
- blank or unusable screenshots on any required production slot;
- screenshot reporting that only exposes inaccessible local paths when remote image content is required;
- repeatable normal-load navigation/transport failures;
- Fadi/Alex real tool-schema mismatch for required functionality;
- routine browser actions require a sensitive-looking public lease value without proven necessity;
- advertised but unusable queue;
- secret leakage;
- V1 regression;
- unrecoverable profile corruption;
- unreliable lease ownership.


## Progress reporting

Human-facing Browser V2 status updates must include an approximate overall completion percentage.

The percentage is a planning estimate, not a test result. It should be based on completed release gates and remaining blockers, not simply on elapsed time.

Each meaningful status update should state:

- approximate overall completion percentage;
- current phase;
- what remains before the next release gate;
- any blocker that materially changes the estimate.

Use a range when uncertainty is high. A failed regression or a newly discovered blocker may lower the estimate. Do not report 100% until the required local Release Gate and independent Fadi/Alex remote acceptance have passed and the agreed cleanup phase is complete.


## Final Browser V2 release regression coverage — 2026-09-30

The final remote acceptance cycle added these permanent regression expectations:

- `browser_status({})` must expose the global five-slot pool view even when the caller owns an active session;
- `browser_status({ session_ref })` must resolve only the owned target session;
- explicit `session_ref` routing must remain a non-secret routing handle and must not be reinterpreted as a lease credential;
- `browser_screenshot_get` must return the previously captured image with correct ownership validation;
- `browser_export_report` must return a portable embedded HTML resource with report URI, MIME type, byte size, and embedded=true metadata rather than relying on a Windows-local path;
- `browser_release({ session_ref })` must remain host-safe, non-destructive, ownership-validated, and functional through the real ChatGPT plugin path;
- post-release global status must return zero active/queued sessions and all five slots FREE;
- the production runtime must report `source_dirty=false` and an approved commit contained in `origin/main`.
