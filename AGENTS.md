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
6. **Do not require the AI caller to resend a credential-like lease token on every browser tool call. Prefer server-side task/session binding.**
7. **If server-side binding is technically impossible, use only a non-secret opaque handle and validate ownership server-side.**
8. **Queue capability must be actionable, not merely advertised. Busy tasks must be able to wait deterministically with a bounded timeout.**
9. **No secrets in Git.**
10. **No raw private page content in telemetry.**
11. **No claims of production readiness without blocking QA.**
12. **Observability is part of the product, not optional instrumentation.**
13. **Use official browser-engine capabilities before adding custom browser logic.**
14. **Tool risk metadata must reflect actual semantics; do not mark routine read-only or local-only actions as destructive without justification.**
15. **Interactive browser status must make window visibility/state diagnosable.**

## V1 lessons are design inputs

Before changing broker, MCP, queue, lease, diagnostics, or permission behavior, read:

- docs/V1_LESSONS_APPLIED.md
- docs/adr/ADR-002-server-side-lease-binding.md
- docs/adr/ADR-003-actionable-fifo-queue.md

These files capture confirmed operational lessons from Fadi Playwright V1 that V2 must not repeat.

## Mental model

Keep these concepts separate:

- client_id: who called the broker;
- auth_profile_id: which persistent login identity is allowed;
- lease_id: internal exclusive task ownership record;
- public task binding: preferably server-side, not a caller-held credential;
- session_id: isolated browser runtime;
- browser process: engine process;
- runtime state: local/private;
- repository state: public/code/docs.

## Side-by-side rule

V2 must use its own project directory, runtime directory, ports, MCP identity, service/task name, logs, auth state, and browser/session storage.

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

## Lease and task binding

Preferred design:

- browser_acquire creates ownership internally;
- the broker binds the active task to the current trusted MCP ingress/session context;
- normal browser tools do not require a credential-like lease token argument;
- browser_release resolves the current owned session internally;
- reconnect/recovery must preserve ownership safely without exposing a reusable credential as a routine browser argument.

Fallback only if required by transport limitations:

- use a non-secret opaque task or lease handle;
- do not label it token/access_token/credential;
- do not rely on secrecy for authorization;
- validate ownership server-side.

## Queue behavior

When capacity is full:

- the caller can join an actionable bounded queue;
- queue policy is deterministic and documented;
- initial policy is FIFO;
- queue position and wait timeout are visible in status;
- live healthy sessions are never stolen or reaped to satisfy queued work.

Global concurrency target starts at 5.

Per-client fairness/caps must be configurable so one client cannot starve all others. Initial shared-use recommendation: max 3 active sessions per client unless tests justify another value.

## Browser operability diagnostics

For interactive/headful sessions, status should expose safe diagnostics such as browser executable, safe profile alias, process ID, window state, visibility, safe active window title, and safe opaque window identifier.

A restore/foreground action may be provided for interactive sessions as long as it does not create duplicate browsers or corrupt profile state.

## Tool metadata

Audit MCP tool annotations individually.

Read-only operations should remain read-only. Local-only window/tab operations should not be marked destructive without justification. External side-effecting actions retain appropriate risk classifications.

The goal is accurate metadata, not weaker safeguards.

## Before changing code

1. Read this file.
2. Read ARCHITECTURE.md.
3. Read project-manifest.yaml.
4. Read docs/V1_LESSONS_APPLIED.md.
5. Read relevant ADRs.
6. Run status and doctor if runtime access exists.
7. Review sanitized diagnostics and metrics before guessing at a problem.
8. Create a branch for non-trivial changes.

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

Compare against the versioned baseline. Measure at least session creation latency, navigation latency, tool latency, queue wait, concurrency, memory, CPU, and failure rate.

Never call an optimization successful without before/after numbers.

## Expected command surface

The implementation should eventually expose simple commands or scripts for start, stop, restart, status, doctor, report, diagnostics, QA, and safe uninstall.

## MCP intent

The public MCP surface should remain simple:

- browser_acquire
- browser_status
- browser_release
- browser_recover if implemented safely
- browser operations resolved against the internally owned session
- actionable queue/wait behavior when capacity is full

Normal browser operations should not require a credential-like lease token to be resent by the model.

## Secret policy

Never commit or expose passwords, OTPs, cookies, API keys, OAuth tokens, refresh tokens, Authorization headers, encryption keys, auth databases, private tunnel secrets, or raw browsing history.

## Documentation duty

If behavior, architecture, auth rules, queue rules, telemetry schema, tool metadata, or operational workflow changes, update the corresponding documentation in the same PR.

Do not rely on conversation memory. A future agent should be able to understand the system from this repository alone.

## Definition of done for substantial changes

- tests pass;
- concurrency regression passes;
- fresh-chat and transport-reconnect ownership tests pass;
- queue wait/timeout tests pass;
- no public credential-like lease argument is required for normal browser actions;
- no session crossover;
- no identity fallback;
- no unnecessary permission prompt is introduced by ordinary lease lifecycle behavior;
- diagnostics remain secret-safe;
- V1 regression check passes where relevant;
- docs updated;
- no secrets introduced.
