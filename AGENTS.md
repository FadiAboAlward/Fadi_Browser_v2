# AGENTS.md

> **If you are an AI agent working on this repository, read this file first.**

## Mission

Fadi Browser V2 provides safe, observable, dynamically allocated browser sessions for multiple AI clients while preserving multiple persistent authentication identities.

It exists because fixed persistent browsers do not scale cleanly to several concurrent AI tasks.

## Non-negotiable invariants

1. **Do not modify Fadi Playwright V1 as part of V2 work.**
2. **Do not make concurrent browser processes share the same live user-data directory.**
3. **Never silently switch authentication identities.**
4. **A lease belongs to one task/client only.**
5. **A task must never operate on a session owned by another lease.**
6. **No secrets in Git.**
7. **No raw private page content in telemetry.**
8. **No claims of production readiness without blocking QA.**
9. **Observability is part of the product, not optional instrumentation.**
10. **Use official browser-engine capabilities before adding custom browser logic.**

## Mental model

Keep these concepts separate:

- client_id: who called the broker;
- auth_profile_id: which persistent login identity is allowed;
- lease_id: exclusive task ownership;
- session_id: isolated browser runtime;
- browser process: engine process;
- runtime state: local/private;
- repository state: public/code/docs.

## Side-by-side rule

V2 must use its own:

- project directory;
- runtime directory;
- ports;
- MCP name/endpoint;
- service or task name;
- logs;
- auth state;
- browser/session storage.

Do not reuse V1 state directories.

## Agent-first execution

Perform routine technical work directly whenever the environment and permissions allow it.

Do not delegate terminal commands, configuration edits, file copies, API configuration, or routine OAuth clicking to the user merely because they are operational steps.

Human interaction should be reduced to genuinely irreducible requirements such as a provider-enforced MFA, hardware key, or CAPTCHA that cannot be completed normally through the browser.

After that single human step, continue automatically.

## Authentication behavior

The agent should complete routine login navigation and OAuth UI itself when the user has already authorized the task or integration and normal browser interaction permits it.

Do not unnecessarily ask the user to click routine OAuth consent buttons.

Never bypass a provider's anti-bot or security challenge. If a provider requires an irreducible CAPTCHA, MFA, or hardware-key step, prepare everything, ask for only that step, then continue automatically.

Never log or commit credentials.

## Before changing code

1. Read this file.
2. Read ARCHITECTURE.md.
3. Read project-manifest.yaml.
4. Read relevant ADRs.
5. Run status and doctor if runtime access exists.
6. Review sanitized diagnostics and metrics before guessing at a problem.
7. Create a branch for non-trivial changes.

## When fixing a bug

Prefer evidence in this order:

1. reproducible test;
2. structured telemetry;
3. sanitized diagnostic bundle;
4. broker/session state;
5. engine stderr;
6. OS resource state.

Do not infer the root cause from a single error string when better evidence exists.

## When improving performance

Compare against the versioned baseline. Measure at least:

- session creation latency;
- navigation latency;
- snapshot or tool latency;
- queue wait;
- peak concurrency;
- memory;
- CPU;
- failure rate.

Never call an optimization successful without before/after numbers.

## Expected command surface

The implementation should eventually expose simple commands or scripts for:

- start
- stop
- restart
- status
- doctor
- report
- diagnostics
- QA
- safe uninstall

## MCP intent

The public MCP semantics should remain simple and lease-oriented:

- browser_acquire
- browser_status
- browser_release
- browser_recover if implemented safely
- browser operations bound to a lease token

Every operation after acquisition must resolve to exactly one owned session.

## Secret policy

Never commit or expose:

- passwords;
- OTPs;
- cookies;
- API keys;
- OAuth tokens;
- refresh tokens;
- Authorization headers;
- encryption keys;
- auth databases;
- private tunnel secrets;
- raw browsing history.

A report may say only things such as:

- configured: true
- present: true
- auth_state: READY

## Documentation duty

If behavior, architecture, auth rules, telemetry schema, or operational workflow changes, update the corresponding documentation in the same PR.

Do not rely on conversation memory. A future agent should be able to understand the system from this repository alone.

## Definition of done for substantial changes

- tests pass;
- concurrency regression passes;
- no session crossover;
- no identity fallback;
- diagnostics remain secret-safe;
- V1 regression check passes where relevant;
- docs updated;
- no secrets introduced.
