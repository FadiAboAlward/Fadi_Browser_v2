# Fadi Browser V2

> A local-first, multi-session browser automation broker for AI agents.

**Current status:** side-by-side production PoC  
**Repository role:** public source of truth for architecture, code, tests, and documentation  
**Runtime role:** local machine keeps authentication state, cookies, tokens, logs, and private mappings

## عربي — ملخص سريع

Fadi Browser V2 هو طبقة تشغيل متصفحات ديناميكية لعدة وكلاء ذكاء اصطناعي في الوقت نفسه. الهدف هو أن يتمكن ChatGPT أو Claude أو Codex أو أي MCP client من طلب جلسة متصفح مستقلة، مرتبطة بهوية تسجيل دخول محددة، والعمل بالتوازي بدون سرقة tabs أو خلط cookies أو إجبار المستخدم على تسجيل الخروج والدخول بين الحسابات.

النظام الجديد يعمل بجانب Fadi Playwright V1 ولا يستبدله أثناء مرحلة الاختبار.

## Why this project exists

A fixed pair of persistent browsers works well for one or two tasks, but becomes fragile when several AI clients work concurrently. Typical failure modes include:

- browser contention;
- tab ownership conflicts;
- task/session crossover;
- one client affecting another client's navigation;
- scaling limited by a fixed number of browsers;
- awkward account switching;
- repeated MFA/OTP when identities are not modeled explicitly;
- poor visibility into why failures happened.

Fadi Browser V2 separates five concepts that must never be conflated:

1. **AI Client** — the caller, such as ChatGPT, Claude, Codex, or another MCP client.
2. **Auth Identity** — the persistent login identity selected for a task.
3. **Lease** — exclusive ownership granted to one task.
4. **Browser Session** — the isolated browser runtime created for that task.
5. **Browser Process** — the underlying browser process managed by the engine.

This separation allows multiple tasks to run concurrently while preserving the correct authenticated identity.

## Target architecture

~~~mermaid
flowchart LR
    A[AI Client] --> B[Fadi Browser V2 MCP]
    B --> C[Policy and Client Mapping]
    C --> D[Lease Broker]
    D --> E[Auth Profile Resolver]
    E --> F[Session Factory]
    F --> G1[Isolated Session 1]
    F --> G2[Isolated Session 2]
    F --> G3[Isolated Session N]
    H[(Local Auth State)] --> E
    I[(SQLite and JSONL Telemetry)] <---> B
~~~

## Core design principles

- **Local first.** Start on the user's Windows machine; VPS deployment is optional later.
- **Side by side.** Never modify, replace, or reuse the live state directories of Fadi Playwright V1 during evaluation.
- **Dynamic sessions.** Browsers are allocated per task, not hard-wired to a specific AI account.
- **Multiple persistent identities.** A user may maintain more than one login identity without repeated sign-out/sign-in.
- **No shared live user-data directory across concurrent processes.** Authentication may be restored from a persistent identity, but active task sessions remain isolated.
- **Thin broker.** Use official browser-engine capabilities; custom code focuses on leases, identity policy, lifecycle, MCP, and observability.
- **Agent-first operations.** Automation performs routine technical work itself rather than delegating terminal/configuration steps to the user.
- **Observable by default.** Important lifecycle events are logged safely from day one.
- **Secrets stay local.** GitHub contains code and safe documentation only.

## AI clients

The broker is client-agnostic. Examples:

- ChatGPT environment A -> default auth profile A
- ChatGPT environment B -> default auth profile B
- Claude -> configured default profile
- Codex -> development and maintenance client

Mappings are local policy, not public repository data.

## Authentication model

An **Auth Profile** is a long-lived identity container. It can contain login state for multiple sites. A task receives an isolated session derived from or restored for the selected identity.

The system should minimize repeated MFA, but it must not bypass a provider's security requirements.

### OAuth

When the user has authorized the integration or task and the provider allows normal browser interaction, the agent should complete the OAuth UI itself. Routine consent clicking should not be handed back to the user unnecessarily.

If the provider presents materially broader permissions than were authorized, that difference must be surfaced instead of silently expanding access.

### CAPTCHA and anti-bot challenges

The agent may navigate to and prepare the challenge flow, but this project does not implement CAPTCHA bypass, challenge-solving services, or anti-bot evasion. If a provider requires a challenge that cannot be completed normally through the browser, only the minimum necessary human interaction is requested, after which the agent resumes automatically.

## Security boundary

**Never commit:**

- cookies;
- passwords;
- OTPs;
- API keys;
- OAuth access or refresh tokens;
- Authorization headers;
- auth profile databases;
- encryption keys;
- tunnel secrets;
- raw production logs;
- browser history;
- screenshots containing private information.

See SECURITY.md.

## Observability

The target telemetry design uses:

- local SQLite for durable structured events and metrics;
- rotating JSONL logs for diagnostics;
- sanitized URLs or origins only;
- no page content, cookies, passwords, tokens, or authorization headers.

We want to answer questions such as:

- How many sessions ran in the last 30 days?
- What was the success rate?
- What was peak concurrency?
- Which operations became slower?
- How often did auth restore fail?
- How often was MFA requested?
- Did any session crossover or tab-ownership violation occur?
- What changed after a specific release?

See docs/OBSERVABILITY.md.

## Repository map

- AGENTS.md — mandatory first read for AI agents.
- ARCHITECTURE.md — system design and invariants.
- SECURITY.md — secret/auth/logging security model.
- OPERATIONS.md — lifecycle and operational expectations.
- docs/PROJECT_CONTEXT.md — detailed problem statement and history.
- docs/AI_HANDOFF.md — how a new AI agent should take over safely.
- docs/AUTH_ARCHITECTURE.md — identities, state, OAuth, MFA.
- docs/OBSERVABILITY.md — logs, metrics, reports, diagnostics.
- docs/QA_STRATEGY.md — blocking acceptance tests.
- docs/adr/ADR-001-side-by-side.md — why V2 is isolated from V1.
- project-manifest.yaml — machine-readable project overview.

## Maturity

This project should not be called production-ready merely because the broker process starts. Production readiness requires blocking QA, including concurrent isolation and a regression check proving the existing V1 setup still works.

Initial target: **5 concurrent isolated sessions**.

## Source-of-truth hierarchy

1. Repository code and versioned configuration schema.
2. Architecture Decision Records.
3. Versioned documentation.
4. Local runtime configuration for private mappings and secrets.
5. Runtime telemetry for observed behavior.

Conversation history is not a source of truth.

## Development policy

Normal change path:

branch -> implementation -> tests -> concurrency regression -> documentation update -> PR -> review -> merge

Any material architecture change should add or update an ADR.

## License

No public license has been selected yet. Until one is explicitly added, normal copyright rules apply even though the repository is public.
