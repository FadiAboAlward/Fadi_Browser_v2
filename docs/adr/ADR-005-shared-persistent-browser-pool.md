# ADR-005 — Shared Persistent Browser Pool

**Status:** Accepted

**Date:** 2026-09-25

## Context

The early V2 design still carried assumptions from client-specific auth profiles. That limited shared allocation and caused real-client tests to fail when one connector tried to use a profile assigned to another client.

The production requirement is different: several authorized AI clients must share a fixed pool of persistent browsers without repeated login, while preserving exclusive task ownership and allowing the user to intervene manually in the same visible browser.

## Decision

Fadi Browser V2 uses a shared pool of fixed persistent browser slots.

- Client identity and browser-slot identity are separate.
- The broker, not the AI client, selects an eligible free slot.
- Each slot uses installed normal Google Chrome.
- Each slot is visible and interactive.
- Each slot has its own persistent user-data directory and loopback CDP endpoint.
- A slot is exclusive while leased.
- The same profile is never used concurrently by multiple Chrome processes.
- Release returns the logical slot to the pool while preserving browser authentication state.
- Human interaction occurs in the same browser window; no separate takeover/pause/resume mode is required.
- Shared-pool authorization is separate from direct legacy auth-profile authorization.

The initial production pool contains five slots.

## Consequences

### Positive

- Any authorized client can consume any eligible free browser slot.
- Authentication state is retained per slot across release/reacquire and normal restart.
- Manual OTP, MFA, CAPTCHA, verification, or account-choice steps are natural because the browser is already visible.
- Client scaling no longer depends on a one-client/one-browser mapping.
- Slot isolation prevents live Chrome profile lock/corruption from concurrent profile reuse.

### Tradeoffs

- Each slot must be authenticated separately when a provider does not offer portable state.
- Five concurrent slots require five independent persistent profile directories.
- Operational status must expose actual slot state; a global concurrency limit alone is insufficient.

## Rejected alternatives

### Bind each AI client to a fixed profile

Rejected because it recreates contention and prevents clients from using free capacity elsewhere in the pool.

### Allow one persistent profile to run concurrently

Rejected because multiple Chrome processes must not share one live user-data directory.

### Grant every client direct access to every auth profile

Rejected because it weakens the distinction between client authorization and shared-pool routing.

### Add a human-takeover state machine

Rejected for the current design because Chrome is already visible and interactive. The user can act in the same window and the AI can continue afterward.

## Verification

The rollout proved the design in stages:

1. one-browser persistence and same-window human/AI continuation;
2. two-slot concurrent isolation;
3. five-slot capacity and queue behavior;
4. real-client verification from Fadi GPT, Goilot GPT, and Claude Desktop;
5. production deployment and smoke test.

The verified production code baseline is `1beadd42b7e964d54cc96853d4b920e644f2af85`.

See `docs/IMPLEMENTATION_PLAYBOOK.md` for the practical rollout sequence and known failure modes.