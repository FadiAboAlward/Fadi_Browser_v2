# Troubleshooting

## First rule

Use evidence before changing architecture.

## Broker unavailable

Check:

1. status;
2. process or service state;
3. configured port;
4. MCP transport;
5. recent broker events;
6. browser-engine doctor;
7. V2-only resource collisions.

Do not modify V1.

## Session allocation slow

Inspect:

- queue wait;
- active and peak concurrency;
- session-create latency;
- CPU and memory pressure;
- engine startup;
- auth restore latency;
- version change.

Compare with baseline.

## Auth restore failed

Inspect auth-profile health and structured AUTH or MFA errors.

Do not:

- switch identity automatically;
- delete the profile immediately;
- repeatedly trigger login attempts that may escalate provider security.

## Wrong page or session

Treat as an isolation incident.

Stop affected work and inspect:

- lease;
- session;
- client;
- auth profile;
- tab ownership events;
- operation timeline.

## Browser crash

Capture:

- engine stderr;
- resource state;
- session count;
- recent operations;
- version.

Verify cleanup or recovery did not transfer ownership incorrectly.

## High memory

Determine whether growth is:

- per active session;
- leaked after release;
- engine-level;
- page-specific.

Compare memory before and after a full release cycle.

## Diagnostics for AI support

Generate sanitized diagnostics and provide that bundle plus:

- repository commit or version;
- timeframe;
- user-visible symptom.

Never provide raw auth directories.


## Persistent login disappears after release

Do not trust `persistent=true` metadata alone.

Check:

- the same real user-data directory is used across leases;
- no temporary context, copy-on-start layer, or ephemeral overlay is created;
- release does not delete or reinitialize profile data;
- Chrome shutdown is graceful when a restart is required;
- the configured profile path is the path Chrome actually uses;
- each slot has its own profile directory and CDP port.

Prove persistence with release/reacquire and normal restart.

## `AUTH_PROFILE_DENIED` during shared-pool testing

Do not broaden direct auth-profile allowlists as the first fix.

Check whether the client is authorized for the shared pool and whether the broker is incorrectly resolving no-argument acquire to a client-specific legacy profile.

Client identity and browser-slot identity must remain separate.

## Acquire works but later ChatGPT tools lose the session

This can be an MCP task-binding problem rather than a browser problem.

Real ChatGPT calls may arrive through refreshed transport sessions. Verify the trusted ingress context used for per-chat binding and keep client identities separated.

Do not expose a credential-like lease token on every routine tool call merely to work around transport refresh.

## Claude Desktop returns broker auth errors while local stdio works

Packaged/Store app environments can see a different AppData view.

Confirm which encrypted local credential path the actual Claude process sees before changing broker auth.

Keep the credential local, encrypted, outside Git, and fail closed when missing or stale.

## Google says the browser or app may not be secure

This can occur even during manual user interaction in a browser launched for automation.

Do not use stealth, anti-detection, or user-agent spoofing.

Use installed normal Chrome with the dedicated persistent V2 profile, let the user complete provider-required authentication manually, and attach the automation to that same supported browser/profile.

## V1 worker is unhealthy

Do not assume V2 caused it.

Test V1 functionally and inspect process/state separation. During the initial V2 production rollout, V1 Edge remained functional while a separate legacy V1 Chrome worker was unhealthy; that condition was independent and did not block V2.
