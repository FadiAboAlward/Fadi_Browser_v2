# QA Strategy

## Principle

A successful process start is not a successful system.

## Blocking acceptance tests

### 1. Basic

- acquire;
- open a harmless page;
- verify URL, title, or heading;
- release.

### 2. Five concurrent sessions

Create five sessions simultaneously.

Each must open a unique URL or anchor.

Verify:

- correct final URL per session;
- no tab stealing;
- no session crossover;
- distinct ownership;
- no identity mismatch.

### 3. Parallel operations

Run navigation and snapshot operations concurrently.

### 4. Release and reuse

Release all sessions, verify cleanup, allocate new ones.

### 5. Crash and restart

Safely simulate V2 broker or engine failure.

Verify:

- no cross-session reassignment;
- cleanup or recovery rules;
- telemetry;
- V1 unaffected.

### 6. Persistence

Use non-sensitive test auth state where possible.

Verify save and restore across restart.

### 7. Auth-policy isolation

Prove a client cannot silently receive a disallowed auth profile.

### 8. Telemetry

Verify events and metrics are emitted without secrets.

### 9. Sanitized diagnostics

Generate a bundle and inspect for secret leakage.

### 10. V1 regression

Run a harmless V1 test after V2 work.

V1 must remain healthy and unchanged.

## Soak test

Before calling V2 stable, run real or synthetic work over multiple days and review:

- failures;
- crash count;
- auth restore;
- resource pressure;
- ownership violations;
- latency trend.

## Release blocking failures

Any of these blocks production readiness:

- session crossover;
- tab ownership violation;
- auth identity fallback;
- secret leakage;
- V1 regression;
- unrecoverable profile corruption;
- unreliable lease ownership.
