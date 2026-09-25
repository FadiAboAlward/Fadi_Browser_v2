# Project Context

## Background

The original browser automation setup proved extremely valuable because it let AI assistants perform real browser workflows rather than merely describe manual steps.

The next limitation appeared when several tasks or AI clients needed to work at the same time.

A small fixed pool of persistent browsers introduces contention:

- two tasks can want the same browser;
- a browser can be healthy but leased by unrelated work;
- tabs can become a shared mutable resource;
- an AI client may operate the wrong page after another client changes focus or navigation;
- fixed browser count becomes the scaling ceiling;
- identity and account switching becomes awkward;
- repeatedly signing out and in may trigger MFA or require the user to remain available.

## Problem statement

We need a browser runtime in which:

- several AI tasks can run concurrently;
- each task gets exclusive browser-session ownership;
- several persistent authenticated identities can exist;
- the correct identity is selected without sign-out and sign-in churn;
- authentication persistence does not require unsafe concurrent use of one live browser profile;
- AI clients are not permanently tied to a physical browser;
- failures are diagnosable after the fact;
- the existing working browser setup remains untouched while V2 is evaluated.

## Key conceptual change

### Old mental model

AI client -> fixed browser

### New mental model

AI client -> policy -> auth identity -> lease -> isolated task session

This makes browsers disposable runtime resources while identities remain persistent logical resources.

## Why auth identity and browser session are different

A login identity may persist for months, while an individual task session may live for minutes.

The system should preserve a durable identity and create isolated task sessions from or restored for that identity.

It must not solve persistence by making multiple concurrent processes fight over the same live profile directory.

## Multiple accounts

The system intentionally supports multiple long-lived identities. This addresses workflows where:

- one AI client normally uses account A;
- another normally uses account B;
- the user does not want repeated sign-out and sign-in;
- MFA or OTP should occur only when the provider actually requires reauthentication.

The public repo never contains the real account mapping.

## OAuth philosophy

The automation should perform routine OAuth navigation and consent itself when the user has already authorized that integration or action and the provider permits normal browser interaction.

The goal is not to push routine clicking back to the user.

However, authorization scope still matters. A new materially broader authorization is not silently assumed.

## CAPTCHA philosophy

CAPTCHA and anti-bot challenges are provider security controls. This project does not attempt to bypass them.

The system should preserve the session, present the exact required challenge, request only the irreducible human step if needed, and resume automatically.

## Why side by side

The current system already provides operational value. Replacing it before V2 proves itself would create unnecessary risk.

Therefore V2 is:

- separately installed;
- separately configured;
- separately logged;
- separately addressed;
- separately authenticated.

Only after sustained evidence should default usage change.

## Success criteria

V2 is successful when real-world use shows:

- no session crossover;
- no tab stealing;
- no identity confusion;
- reliable auth restoration;
- five concurrent sessions initially;
- useful diagnostics;
- acceptable resource usage;
- no regression to V1.

## Production outcome

The initial production target was reached on 25 Sep 2026. The final runtime uses five persistent visible Chrome slots shared by authorized AI clients. Client identity is no longer a permanent browser assignment; the broker allocates a free slot and preserves exclusive ownership for the lease. Human intervention for login, OTP, MFA, CAPTCHA, or verification occurs in the same visible browser, after which the AI can continue.

The verified deployment baseline is `1beadd42b7e964d54cc96853d4b920e644f2af85`. See `docs/IMPLEMENTATION_PLAYBOOK.md` for the proven build order, rollout failures, and production checklist.

## Long-term vision

The repository should become understandable and maintainable by any competent developer or AI coding agent without needing private conversation history.

Code, decisions, schemas, docs, tests, and sanitized diagnostics should make future work evidence-driven.
