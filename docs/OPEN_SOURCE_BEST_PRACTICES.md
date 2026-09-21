# Open-Source Best Practices Applied to Fadi Browser V2

## Purpose

This document records implementation lessons from established open-source browser-automation projects and current upstream issue reports. It exists so V2 does not depend on conversational memory or repeat known concurrency/authentication mistakes.

Research reviewed on 21 Sep 2026 included:

- Microsoft Playwright MCP
- Vercel Labs agent-browser
- Browserless
- Browser Use
- Steel Browser documentation
- relevant upstream GitHub issues and release notes

This document is guidance for V2 implementation. Upstream behavior can change, so version-specific assumptions must be verified against the pinned engine release.

## 1. Never share one live user-data directory across concurrent browser processes

This is the strongest cross-project lesson.

Microsoft Playwright MCP explicitly warns that one persistent profile can only be used by one browser instance at a time. Parallel clients should use isolated contexts or distinct user-data directories.

agent-browser and Browser Use issue reports show the same failure mode: Chrome's singleton profile lock can redirect a second launch into the first browser, causing tab accumulation, navigation failures, hangs, or cross-agent interference.

### V2 rule

- One active browser process/session gets one active writable runtime profile directory.
- Never point several concurrent sessions at the same live writable profile.
- Persistent identity and active task runtime are separate concepts.
- If an identity must be reused, derive or restore state into an isolated runtime session.

## 2. Session name alone is not sufficient isolation

agent-browser named sessions isolate daemon/session state, but upstream issues show that sharing the same Chrome profile or attaching several sessions to one default CDP browser context can still cause interference.

### V2 rule

Do not treat session IDs as a substitute for browser-context/profile isolation.

Isolation must be verified at:

- session ownership layer;
- browser context/process layer;
- storage/cookie layer;
- tab ownership layer.

## 3. Do not rely on shared-CDP tab pinning as a security boundary

agent-browser supports tab pinning to reduce accidental focus/tab switching, but upstream issue reports show that another session attached to the same Chrome process can still explicitly target that tab.

### V2 rule

- Pinning may improve usability.
- Pinning is not ownership enforcement.
- V2 ownership enforcement remains broker-side.
- For independent agents, prefer separate isolated browser contexts/processes instead of one shared Chrome default context.

## 4. Authentication persistence should use a known-good-state model

agent-browser supports session restore and validation checks before overwriting saved state.

### V2 rule

For each auth identity:

- maintain a known-good persisted state;
- restore into an isolated task session;
- validate that the expected logged-in state is present;
- only then allow updated state to replace the known-good state;
- failed restore/validation must not overwrite the last healthy state.

Where supported, use checks analogous to:

- expected URL;
- expected visible account/dashboard marker;
- small safe validation function.

## 5. Some logins are device-bound and cannot be reconstructed from cookies alone

Current upstream reports show that modern Google/Chrome authentication can rely on device-bound credentials or browser-profile material beyond ordinary cookie/localStorage exports.

### V2 rule

Do not promise that every account can be cloned into arbitrary isolated sessions using cookies alone.

Support two identity modes:

### Portable auth identity

Can be safely restored from encrypted browser state.

### Profile-bound auth identity

Requires a dedicated persistent browser profile/runtime identity.

For profile-bound identities:

- do not share the live writable profile concurrently;
- serialize use of that identity, or create independently authenticated dedicated identities if true concurrency is required;
- expose this limitation clearly in auth-profile health/capabilities.

This is especially important for Google-family accounts and any provider using device-bound session credentials.

## 6. Encrypt authentication state at rest

agent-browser supports state encryption and its documentation warns that state files can contain session tokens.

### V2 rule

- Auth state remains local.
- Encrypt persisted state at rest when the engine supports it.
- Encryption keys never enter Git.
- Diagnostics never contain raw state.
- State files remain ignored by Git.

## 7. Pin the engine version and use canary upgrades

agent-browser is developing quickly and current Windows issues still appear in upstream reports.

### V2 rule

- Pin one exact tested agent-browser version.
- Do not auto-upgrade production runtime.
- Upgrade on a branch/canary first.
- Run the full concurrency/auth/reconnect/Windows regression suite.
- Promote only after passing.
- Keep a known-good previous version for rollback.

## 8. Treat Windows as its own compatibility target

Recent agent-browser issues have included Windows-specific launch, headless-window, init-script, and daemon behavior.

### V2 rule

Our Windows QA is first-class, not assumed equivalent to Linux/macOS.

Every engine upgrade should test:

- launch;
- headed mode;
- process cleanup;
- restart;
- profile restore;
- browser visibility/window state;
- navigation;
- MCP lifecycle;
- five-session concurrency.

Avoid optional engine features on Windows until tested.

## 9. Keep launch configuration stable across a session

Upstream reports show daemon behavior can change or restart when launch-affecting configuration differs between commands or is not preserved after an idle relaunch.

### V2 rule

For each active session, compute an immutable launch configuration at creation time and persist it in broker state.

Do not allow ordinary tool calls to silently change:

- profile path;
- executable;
- headed/headless mode;
- restore key;
- namespace;
- extensions/init scripts;
- browser engine.

A configuration change requires a controlled session replacement.

## 10. Explicit release plus bounded idle cleanup

Both mature browser services and agent-browser use explicit session lifecycle plus timeout cleanup.

### V2 rule

- normal completion uses explicit release;
- idle timeout is a safety net, not the main lifecycle;
- broker crash cleanup must be deterministic;
- released resources must disappear from active counts;
- no stale session should survive indefinitely.

## 11. Concurrency requires both a cap and a real queue

Browserless exposes explicit concurrency and queue controls. This matches the V1 lesson that merely reporting queue availability is insufficient.

### V2 rule

- global concurrency cap;
- configurable per-client fairness cap;
- bounded FIFO queue;
- queue position;
- wait timeout;
- safe cancellation;
- no live lease theft.

Initial values remain:

- global target: 5 active sessions;
- initial per-client recommendation: 3 active sessions.

These values are tunable from telemetry, not hard-coded forever.

## 12. Prefer isolated browser instances over shared-cookie convenience

Community requests repeatedly ask for "many agents, one live login store." The recurring difficulty is that shared cookies/profile state also creates shared mutable browser state and ownership hazards.

### V2 rule

Correctness wins over convenience.

If a provider's identity cannot be safely cloned:

- serialize that identity;
- or authenticate additional dedicated identities.

Do not weaken session isolation merely to avoid a login.

## 13. Keep MCP/browser output small and bounded

Long-running agent frameworks report performance degradation from repeated large DOM/state serialization and growing model context.

Recent agent-browser releases add delta snapshots and conditional screenshots specifically to reduce repeated output.

### V2 rule

Where supported and safe:

- prefer accessibility snapshots/refs over full DOM dumps;
- use delta snapshots for repeated checks;
- cap tool output size;
- do not send screenshots unless useful;
- do not repeatedly return unchanged page state;
- keep diagnostics separate from normal model context.

Measure token/output volume as part of long-run performance testing.

## 14. Separate browser infrastructure from business actions

The browser broker should allocate, isolate, observe, and recover sessions. It should not duplicate every website-specific workflow.

### V2 rule

Keep the custom layer thin:

- identity policy;
- leases;
- queue;
- lifecycle;
- observability;
- deployment/versioning.

Use agent-browser or Playwright primitives for browser control.

## 15. Borrow the profile lifecycle model used by mature browser services

Steel's profile model follows a useful pattern: a session loads an identity snapshot, the session owns active state, and persisted profile updates happen at a controlled release/save boundary.

### V2 rule

Think of Auth Profile as a durable identity snapshot, not as a live shared browser directory.

Updates must be transactional:

1. load known-good identity;
2. run isolated session;
3. validate final auth health;
4. persist new version;
5. atomically promote it as known-good.

If validation fails, keep the prior known-good identity.

## 16. Operational design priority

Order of priorities:

1. identity/session correctness;
2. no cross-client interference;
3. deterministic cleanup/recovery;
4. auth persistence;
5. observability;
6. latency;
7. maximum concurrency.

Do not trade the first four for higher browser count.

## Required implementation consequences

These research findings are mandatory inputs for V2:

- unique active runtime profile/context per concurrent session;
- no shared writable profile across active sessions;
- server-side ownership;
- actionable bounded FIFO queue;
- immutable per-session launch config;
- known-good auth restore validation;
- encrypted local auth state;
- support for profile-bound identities that may need serialized access;
- pinned engine version with canary upgrade policy;
- Windows-specific QA;
- bounded browser/model output;
- explicit release plus idle cleanup.

## References

Primary upstream references are linked from:

- Microsoft Playwright MCP repository and profile documentation
- Vercel Labs agent-browser README, session management, authentication, configuration, changelog, releases, and issue tracker
- Browserless concurrency/configuration documentation and source
- Browser Use parallel-browser examples and profile-lock issue reports
- Steel Sessions/Profile documentation

Do not assume an old upstream issue remains present forever. Re-check the pinned version before implementing a workaround.
