# Diagnostic Data Contract

## Purpose

This document defines the minimum safe data that local tooling should expose so a future AI agent can diagnose reliability and performance without reading private browsing content.

## Safe diagnostic record

A diagnostic event may include:

- timestamp;
- project version;
- engine version;
- event type;
- client alias or hash;
- auth profile alias or hash;
- lease reference or hash;
- session reference;
- operation;
- duration;
- queue wait;
- concurrency count;
- success flag;
- structured error category and code;
- browser or broker lifecycle state;
- CPU and memory snapshot;
- sanitized hostname or origin when required.

## Forbidden diagnostic fields

Never include:

- password;
- OTP or MFA code;
- cookie values;
- access or refresh tokens;
- API key values;
- Authorization header values;
- full browser profile databases;
- DOM text;
- form contents;
- request or response bodies containing private data;
- private screenshots by default.

## Required report windows

Local reporting should support at least:

- last 1 day;
- last 7 days;
- last 14 days;
- last 30 days.

## Required questions

The data model should make it possible to answer:

1. How many sessions were requested, created, released, failed, or reaped?
2. What was the success rate by version?
3. What was peak concurrency?
4. Where did users wait: queue, session creation, navigation, snapshot, or auth restore?
5. Which error categories dominate?
6. How often did the browser or broker crash?
7. How often did authentication restoration fail?
8. How often was MFA or re-auth required?
9. Were any ownership or identity violations detected?
10. Did performance regress after an upgrade?

## Version correlation

Every startup and event stream should make the active project and browser-engine versions available so regressions can be correlated with releases.

## Local-first rule

Raw operational telemetry remains local by default.

Only sanitized summaries or diagnostic bundles should be shared with remote AI systems or GitHub issues.
