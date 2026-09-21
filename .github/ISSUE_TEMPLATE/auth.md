---
name: Authentication issue
about: Report auth restore, re-authentication, MFA, or identity policy problems
title: "[AUTH] "
labels: auth
---

## Symptom

Describe the authentication behavior without including credentials.

## Auth health

- [ ] READY
- [ ] REAUTH_REQUIRED
- [ ] MFA_REQUIRED
- [ ] BROKEN
- [ ] UNKNOWN

## Behavior

- Auth restore succeeded before:
- Re-auth requested:
- MFA requested:
- Silent identity fallback observed:

## Isolation concern

Did the task ever appear to use the wrong identity?

If yes, treat this as a high-severity isolation incident.

## Sanitized evidence

Use safe event identifiers, timestamps, and error categories only.

Never paste passwords, OTP codes, cookies, tokens, or authorization headers.
