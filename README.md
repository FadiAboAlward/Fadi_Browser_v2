# Fadi Browser V2

> A local-first, multi-session browser automation broker for AI agents.

**Current status:** side-by-side production PoC  
**Repository role:** public source of truth for architecture, code, tests, and documentation  
**Runtime role:** local machine keeps authentication state, cookies, tokens, logs, and private mappings

## عربي — ملخص سريع

Fadi Browser V2 هو طبقة تشغيل متصفحات ديناميكية لعدة وكلاء ذكاء اصطناعي في الوقت نفسه. الهدف هو أن يتمكن ChatGPT أو Claude أو Codex أو أي MCP client من طلب جلسة متصفح مستقلة، مرتبطة بهوية تسجيل دخول محددة، والعمل بالتوازي بدون سرقة tabs أو خلط cookies أو إجبار المستخدم على تسجيل الخروج والدخول بين الحسابات.

النظام الجديد يعمل بجانب Fadi Playwright V1 ولا يستبدله أثناء مرحلة الاختبار.

V2 مبني أيضًا على الدروس المؤكدة من تشغيل V1 الفعلي. أهم هذه الدروس: إبقاء ملكية الـlease داخل الـbroker قدر الإمكان بدل جعل الـAI يعيد إرسال قيمة حساسة المظهر في كل أداة، توفير Queue قابلة للاستخدام فعلًا عند امتلاء السعة، وإظهار حالة نافذة المتصفح وتشخيصها بوضوح.

راجع: docs/V1_LESSONS_APPLIED.md

## Why this project exists

A fixed pair of persistent browsers works well for one or two tasks, but becomes fragile when several AI clients work concurrently. Typical failure modes include:

- browser contention;
- tab ownership conflicts;
- task/session crossover;
- one client affecting another client's navigation;
- scaling limited by a fixed number of browsers;
- awkward account switching;
- repeated MFA/OTP when identities are not modeled explicitly;
- poor visibility into why failures happened;
- lease handling that creates unnecessary approval friction;
- queue capability that exists internally but is not actionable from the client.

Fadi Browser V2 separates five concepts that must never be conflated:

1. **AI Client**
2. **Auth Identity**
3. **Internal Lease**
4. **Browser Session**
5. **Browser Process**

## Target architecture

~~~mermaid
flowchart LR
    A[AI Client] --> B[Fadi Browser V2 MCP]
    B --> C[Policy and Client Mapping]
    C --> D[Lease Broker]
    D --> Q[Bounded FIFO Queue]
    D --> E[Auth Profile Resolver]
    Q --> E
    E --> F[Session Factory]
    F --> G1[Isolated Session 1]
    F --> G2[Isolated Session 2]
    F --> G3[Isolated Session N]
    H[(Local Auth State)] --> E
    I[(SQLite and JSONL Telemetry)] <---> B
~~~

## Core design principles

- **Local first.**
- **Side by side with V1.**
- **Dynamic sessions.**
- **Server-side ownership.** Prefer broker-side task/session binding so ordinary tools do not require a sensitive-looking public lease value.
- **Actionable queue.** When capacity is full, callers can wait deterministically with a bounded timeout.
- **Multiple persistent identities.**
- **No unsafe shared live user-data directory across concurrent processes.**
- **Thin broker.**
- **Agent-first operations.**
- **Observable by default.**
- **Accurate tool metadata.**
- **Secrets stay local.**

## Authentication model

An Auth Profile is a long-lived identity container. A task receives an isolated session derived from or restored for the selected identity.

Routine OAuth should be completed by the agent when already authorized. Provider-enforced MFA, hardware keys, or CAPTCHA may still require minimal human interaction. The project does not implement CAPTCHA bypass or anti-bot evasion.

## Security boundary

Never commit cookies, passwords, OTPs, API keys, OAuth tokens, Authorization headers, auth profile databases, encryption keys, tunnel secrets, raw production logs, browser history, or private screenshots.

## Observability

The target telemetry design uses local SQLite plus rotating JSONL logs, with sanitized identifiers and no private page content.

We want to know session volume, success rate, queue wait, P50/P95 latency, peak concurrency, auth restore failures, MFA events, ownership violations, browser crashes, window visibility/state, and regressions by version.

## Repository map

- AGENTS.md — mandatory first read for AI agents.
- ARCHITECTURE.md — system design and invariants.
- SECURITY.md — secret/auth/logging security model.
- OPERATIONS.md — lifecycle and operational expectations.
- docs/PROJECT_CONTEXT.md — detailed problem statement and history.
- docs/AI_HANDOFF.md — how a new AI agent should take over safely.
- docs/AUTH_ARCHITECTURE.md — identities, state, OAuth, MFA.
- docs/V1_LESSONS_APPLIED.md — confirmed V1 lessons translated into V2 requirements.
- docs/MCP_INTERFACE.md — public broker/MCP contract.
- docs/OBSERVABILITY.md — logs, metrics, reports, diagnostics.
- docs/QA_STRATEGY.md — blocking acceptance tests.
- docs/adr/ADR-001-side-by-side.md
- docs/adr/ADR-002-server-side-lease-binding.md
- docs/adr/ADR-003-actionable-fifo-queue.md
- project-manifest.yaml — machine-readable project overview.

## Maturity

Production readiness requires blocking QA, including concurrent isolation, queue behavior, fresh-chat/reconnect ownership tests, and a regression check proving V1 still works.

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

No public license has been selected yet.
