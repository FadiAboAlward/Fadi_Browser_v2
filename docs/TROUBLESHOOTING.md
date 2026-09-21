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
