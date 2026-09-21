# Security Model

## Goals

1. Keep credentials and authenticated state off GitHub.
2. Prevent cross-task browser/session access.
3. Prevent silent identity switching.
4. Keep diagnostics useful without capturing private content.
5. Make installation and removal reversible and isolated from V1.

## Secret classes

Treat all of the following as secrets:

- passwords;
- OTP or MFA codes;
- cookies;
- session tokens;
- OAuth access and refresh tokens;
- API keys;
- Authorization headers;
- encryption keys;
- private tunnel credentials;
- browser auth databases.

## Storage

Secrets belong only in local protected runtime storage or an appropriate OS secret mechanism.

The repository may contain:

- configuration schemas;
- placeholders;
- variable names;
- examples with fake values.

It must never contain real secret values.

## OAuth policy

Routine OAuth browser interaction may be automated when the user has already authorized the relevant integration or task.

A provider may still require a new approval when permissions materially change. Do not silently expand scopes beyond what the user authorized.

## CAPTCHA and anti-bot policy

This project does not implement CAPTCHA bypass, external challenge-solving services, fingerprint evasion, or anti-bot circumvention.

The browser agent may:

- navigate to the challenge;
- preserve the correct session;
- wait for minimal legitimate human interaction if required;
- resume automatically afterward.

## Auth-profile isolation

Concurrent tasks must not attach to the same live profile directory if the engine or provider does not support safe concurrent ownership.

Authentication persistence and task-session isolation are separate concerns.

## Logging

Logs must redact or omit:

- query strings by default;
- cookies;
- request authorization;
- request and response bodies with user data;
- DOM text;
- passwords and OTPs.

Prefer hostname or origin rather than full URLs.

## Public diagnostics

A diagnostic bundle is shareable only after sanitization. It may contain:

- versions;
- process and service status;
- safe configuration;
- aggregate metrics;
- error categories;
- sanitized recent events.

It must not contain auth state.

## Git hygiene

Before release:

- run secret scanning;
- verify ignored runtime directories;
- inspect staged changes for auth or log files;
- never force-add ignored auth material.

## Incident response

If a secret is accidentally committed:

1. rotate or revoke the secret immediately;
2. stop relying on deletion from Git history as the only fix;
3. remove it from current and historical Git state where practical;
4. document the incident without repeating the secret;
5. add prevention tests or patterns.
