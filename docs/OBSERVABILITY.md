# Observability

## Purpose

The system must be diagnosable after days or weeks of real use.

Observability should answer what happened without recording private browsing content.

## Storage targets

### SQLite

Durable structured event and metric store.

### Rotating JSONL

Human and AI-readable local diagnostic stream.

Default target retention: 30 days.

No cloud telemetry by default.

## Core event fields

- timestamp;
- project or broker version;
- engine version;
- event_type;
- client_id or safe alias or hash;
- auth_profile_id or safe alias or hash;
- lease_id safe hash or reference;
- session_id safe reference;
- operation;
- duration_ms;
- success;
- error_category;
- error_code;
- concurrency_count;
- queue_wait_ms;
- sanitized origin where needed;
- resource snapshot where cheap.

## Event types

- broker_started
- broker_stopped
- session_requested
- session_queued
- session_created
- session_restored
- session_released
- session_reaped
- session_crashed
- browser_started
- browser_crashed
- auth_restore_started
- auth_restore_success
- auth_restore_failed
- reauth_required
- mfa_required
- navigation_started
- navigation_completed
- navigation_failed
- tool_started
- tool_completed
- tool_failed
- lease_created
- lease_recovered
- lease_expired
- policy_denied
- resource_pressure
- health_check
- version_changed
- session_crossover_detected
- tab_ownership_violation

## Required aggregate metrics

- total sessions;
- successful sessions;
- failed sessions;
- success rate;
- average, P50, and P95 session duration;
- average, P50, and P95 tool latency;
- queue wait average and P95;
- peak concurrent sessions;
- browser crash count;
- broker restart count;
- auth restore success rate;
- re-auth count;
- MFA-required count;
- stale lease count;
- forced cleanup count;
- ownership violations;
- resource-pressure events;
- errors by category, tool, client, auth alias, and version.

## Privacy

Do not log:

- passwords;
- OTP;
- cookies;
- authorization headers;
- token contents;
- full private URL query strings;
- DOM or page text;
- screenshots by default;
- request and response bodies containing private data.

Prefer origin or hostname.

## Report command

Support at least:

- 1 day;
- 7 days;
- 14 days;
- 30 days.

Include version comparison where enough data exists.

## Diagnostic bundle

Generate a sanitized archive containing:

- versions;
- process and service state;
- port and health results;
- safe config;
- recent structured errors;
- aggregate metrics;
- latest QA or test outputs;
- relevant OS and resource metadata.

It must exclude auth state.

## Performance regression

A change is a performance regression when measured behavior materially worsens versus the versioned baseline under comparable workload.

Never rely only on subjective reports that the system feels slower.
