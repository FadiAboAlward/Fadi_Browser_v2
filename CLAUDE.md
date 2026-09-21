# Claude Working Guide

Read AGENTS.md first. This file only adds Claude-oriented working notes and does not override repository-wide rules.

## What this project is

A local-first MCP browser-session broker that gives concurrent AI tasks isolated browser sessions while selecting from persistent authentication identities.

## Before work

- Read AGENTS.md and ARCHITECTURE.md.
- Inspect project-manifest.yaml.
- Review CHANGELOG.md and relevant ADRs.
- Prefer existing tests and telemetry over assumptions.
- Keep V1 untouched.

## Implementation preferences

- Keep the custom broker thin.
- Prefer explicit schemas for leases, sessions, auth states, events, and errors.
- Prefer deterministic state machines over implicit lifecycle behavior.
- Treat client identity and auth identity as different fields.
- Make cleanup and recovery idempotent where practical.
- Avoid hidden global current-session state.

## Required validation

For non-trivial changes:

- unit tests;
- integration tests;
- concurrent session isolation;
- release and reuse;
- restart or crash behavior where relevant;
- secret scanning;
- documentation update.

## Never

- commit runtime or auth data;
- silently change an auth identity;
- reuse V1 profiles for concurrent V2 execution;
- disable logging to make a test pass;
- suppress errors that affect ownership or isolation;
- bypass CAPTCHA or anti-bot protections.
