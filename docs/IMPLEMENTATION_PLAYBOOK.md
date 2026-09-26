# Browser V2 Implementation Playbook

> Practical build, migration, verification, and troubleshooting guidance distilled from the production rollout completed on 25 Sep 2026.

## Purpose

This document exists so a new developer or coding agent can reproduce the working design without repeating the dead ends encountered during the first rollout.

It complements, rather than replaces:

- `README.md`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/CLIENT_INTEGRATION.md`
- `docs/RELEASE_PROCESS.md`
- `docs/TROUBLESHOOTING.md`

The verified production code baseline is:

`1beadd42b7e964d54cc96853d4b920e644f2af85`

That commit was deployed and passed the production smoke test with five free slots, zero active sessions, zero queued sessions, successful navigation to Example Domain, preserved Sentry authentication, and clean release.

## Final functional model

The production model is intentionally simple:

1. Several authorized AI clients share one browser pool.
2. The pool contains five fixed persistent browser slots.
3. Each slot owns its own installed Google Chrome process/profile state, unique user-data directory, and loopback CDP endpoint.
4. Chrome is visible and interactive.
5. The user may interact with the same Chrome window at any time for OTP, MFA, account selection, CAPTCHA, verification, or any other manual step.
6. The AI resumes control of that same browser/session afterward.
7. The broker allocates the first eligible free slot.
8. A slot is exclusive while leased.
9. Releasing the AI lease preserves browser authentication state.
10. Client identity is independent from browser-slot identity.

Do not recreate the old mental model:

`AI client -> fixed browser/profile`

Use:

`AI client -> trusted client identity -> shared pool -> free persistent slot -> exclusive lease`

## Proven clients

The production rollout was validated with real clients, not only local simulations:

- Fadi ChatGPT -> Fadi GPT -> Browser V2
- Alex ChatGPT -> Goilot GPT -> Browser V2
- Claude Desktop -> Browser V2

Each completed the functional path required for its verification.

## Recommended implementation sequence

### Phase 1 — Prove one browser before building a pool

Start with one dedicated V2-owned Chrome profile.

Requirements:

- installed normal Google Chrome;
- visible;
- interactive;
- persistent dedicated user-data directory;
- unique loopback CDP port;
- no reuse of the user's personal default Chrome profile;
- no second Chrome process pointed at the same live user-data directory.

Prove all of the following before expanding:

1. Acquire.
2. Navigate.
3. User manually interacts with the same visible window.
4. AI continues in the same session.
5. User signs in to a test service.
6. Release.
7. Reacquire the same profile.
8. Authentication is still present.
9. Restart Chrome/V2 normally.
10. Reacquire again.
11. Authentication is still present.

A metadata field such as `persistent=true` is not proof. Persistence must survive release/reacquire and restart in a real browser.

### Phase 2 — Treat provider login separately from persistence

A provider may reject login even when the user performs it manually inside an automation-launched browser.

Do not respond with stealth, anti-detection, user-agent spoofing, or other security-bypass techniques.

Use the clean path:

- installed normal Chrome;
- dedicated persistent profile;
- visible/manual authentication;
- agent-browser attaches to that same Chrome/profile using the supported connection mechanism;
- verify the authenticated session survives AI attach, release, and restart.

If the provider still requires MFA, OTP, CAPTCHA, hardware key, or manual account choice, keep the same browser visible and let the user complete only that step.

There is no separate "human takeover" mode in the production design. Human and AI use the same browser window.

### Phase 3 — Separate client identity from browser-slot identity

This was a major architectural correction.

Do not let:

- Fadi GPT own one browser profile permanently;
- Goilot GPT own another permanently;
- Claude own another permanently.

Instead:

- client identity controls authorization;
- pool policy controls which pools the client may use;
- the broker selects a free slot;
- the slot keeps its own persistent authentication state.

A client should normally request the shared pool without selecting a slot.

Do not fix `AUTH_PROFILE_DENIED` by broadly granting one client direct access to another client's legacy auth profile. Fix the routing model.

### Phase 4 — Prove two slots concurrently

Before creating five slots, create two.

Expected test:

- Client A acquires slot 1 and remains ACTIVE.
- Client B independently acquires slot 2.
- Both are visible, interactive Chrome instances.
- Neither affects the other's navigation or lease.
- Releasing A leaves B active.
- Releasing B returns both slots to FREE.
- Reacquiring each slot preserves its own authentication.

This proves shared allocation and isolation.

### Phase 5 — Expand from two to five

Only after the two-slot test passes:

- add three more independent persistent Chrome slots;
- give each a unique profile directory and CDP port;
- authenticate each slot once as needed;
- verify release/reacquire persistence;
- verify restart persistence;
- acquire all five concurrently;
- verify a sixth immediate request follows capacity policy;
- verify a bounded queued request is promoted when a slot is released;
- finish with zero active and zero queued sessions.

Important: `concurrency_limit=5` does not mean five usable browser slots exist. Verify the actual pool contains five configured slots.

## Authentication bootstrap

Each persistent slot is independent.

Do not assume a login made in browser-1 appears in browser-2 through browser-5.

The safe default is:

- bootstrap each slot once;
- log in manually where a provider requires manual authentication;
- preserve that slot's profile state afterward.

Do not copy a live Chrome profile directory between slots. Independent profiles avoid lock corruption and ambiguous browser state.

## ChatGPT client lessons

### Connector visibility is not the same as runtime usability

An app or connector appearing in settings does not prove its tools are available in a specific chat runtime.

Verify with actual tool calls.

### Workspace association matters

A tunnel can exist and still fail to appear in ChatGPT if it is not associated with the correct ChatGPT workspace.

Check workspace association before creating duplicate tunnels or credentials.

### Chat transport can refresh between tool calls

A real ChatGPT client may use fresh MCP transport sessions across calls.

A successful `browser_acquire` followed by "no bound session" on navigate/release can therefore be a binding problem rather than a browser problem.

The production fix uses trusted ingress context to maintain per-chat server-side task binding while keeping Fadi GPT and Goilot GPT identities separated.

Do not expose routine credential-like lease arguments to compensate for transport refresh unless the transport genuinely forces that fallback.

## Claude Desktop lesson

The Microsoft Store/packaged Claude Desktop environment may see a different AppData view than a normal local shell.

Symptom:

- the same stdio bridge works locally;
- Claude Desktop reaches the broker;
- the broker rejects authentication.

Do not immediately change broker authentication.

First confirm whether the packaged app is reading a different encrypted credential path.

The production machine uses a private local path outside Git for Claude's wrapper to reach the same DPAPI-protected broker credential. Missing or stale local credential state must fail closed.

Never store the broker credential in plaintext or commit it.

## Release behavior

A normal browser release should:

- release logical AI ownership;
- return the slot to FREE;
- preserve the persistent Chrome profile and login state.

Do not clear cookies or rebuild the profile on release.

Do not automatically close/recreate Chrome merely to switch between human and AI interaction.

## V1 coexistence

V1 and V2 are separate systems.

Rules:

- do not modify V1 while fixing V2;
- do not infer a V2 regression merely because a V1 worker is unhealthy;
- test coexistence functionally.

During the production rollout, V1 Edge was functionally verified while V2 was also operating. A separate legacy V1 Chrome worker was unhealthy on that installation; the problem was independent from V2 and did not block V2 production activation.

Treat future V1 incidents as separate unless evidence proves a shared-resource regression.

## Deployment lesson

The production deployment script requires the approved commit to be contained in `origin/main`.

A commit that is fully tested on a feature branch is not deployable through the approved path until it is present on main.

Recommended release flow:

1. complete local QA;
2. create an explicit final commit;
3. push the exact commit;
4. ensure the approved commit is contained in `origin/main`;
5. deploy that explicit commit;
6. verify the running commit;
7. run the production smoke test;
8. confirm final cleanup.

Do not bypass the deployment guard just to save a step.

## Final production smoke test

Minimum post-deploy verification:

1. `browser_status`
2. Broker/MCP/browser engine healthy.
3. Five slots present.
4. Zero active and zero queued sessions before test.
5. Acquire from default shared pool.
6. Navigate to `https://example.com`.
7. Snapshot contains `Example Domain`.
8. Navigate to a known authenticated service such as Sentry.
9. Confirm login state persists.
10. Release.
11. Verify session is CLOSED.
12. Verify all five slots are FREE.
13. Verify zero active and zero queued sessions.

For a new client integration, additionally run the smoke test from that real client UI, not only from a local simulated MCP invocation.

## Common dead ends to avoid

### Do not equate pool capacity with configured browsers

A broker can advertise a capacity of five while only two actual persistent slots exist.

Always inspect slot state.

### Do not bind slots to AI identities

This recreates the scaling problem V2 was designed to solve.

Clients are authorized consumers. Browser slots are shared persistent resources.

### Do not make the same profile concurrent

Five concurrent sessions require five independent persistent slots, not five processes sharing one user-data directory.

### Do not solve shared-pool routing by weakening auth-profile policy

Keep direct legacy profile access separate from shared-pool authorization.

### Do not create all five before proving one and then two

The proven rollout sequence was:

one browser -> persistence -> two-slot concurrency -> five slots -> real clients -> production.

### Do not treat manual interaction as a special mode

The browser should already be visible and interactive.

The user can intervene naturally, then the AI continues.

### Do not repeatedly redo successful QA

Once a layer is proven, move to the next unverified layer unless a later regression gives evidence that the previous layer broke.

### Do not infer cause from one error string

Examples from the rollout included:

- connector not exposed in a chat;
- workspace association missing;
- auth-profile policy blocking pool use;
- task binding lost across ChatGPT transport calls;
- packaged Claude credential virtualization;
- independent V1 worker outage.

These looked similar at the user level but had different causes.

## Functional readiness checklist

A Browser V2 build is production-ready only when all required items are true:

- broker healthy;
- MCP healthy;
- browser engine healthy;
- five persistent slots configured;
- visible/interactable Chrome;
- unique profile directory per slot;
- shared-pool routing independent from client identity;
- exclusive lease ownership;
- human interaction followed by AI continuation;
- authentication survives release/reacquire;
- authentication survives normal restart;
- real Fadi GPT path verified where applicable;
- real Goilot GPT path verified where applicable;
- real Claude path verified where applicable;
- capacity/queue behavior verified;
- clean release;
- zero orphaned sessions after tests;
- secret scan passes;
- approved commit is on main;
- running commit matches the approved deployment commit;
- post-deploy smoke test passes.

## Current production snapshot

As of 25 Sep 2026:

- verified code baseline: `1beadd42b7e964d54cc96853d4b920e644f2af85`;
- production activation: PASS;
- running commit matched the approved baseline at activation time;
- five-slot pool: PASS;
- Example Domain smoke test: PASS;
- Sentry persistence: PASS;
- release: PASS;
- final cleanup: PASS;
- final active sessions: 0;
- final queued sessions: 0;
- final status: LIVE AND VERIFIED.

Future documentation-only commits may advance `main` beyond the deployed code baseline. Record the actually deployed commit explicitly; do not infer it from the latest documentation commit.
