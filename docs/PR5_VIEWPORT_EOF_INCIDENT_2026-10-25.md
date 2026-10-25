# Fadi Browser V2 — PR #5 viewport / EOF incident handoff (25 Oct 2026)

**Final status:** PR #5 **failed live ChatGPT connector acceptance**; merged prematurely, then reverted. Existing Windows V2 was rolled back to the previous source tree; all five slots FREE, no active/queued sessions in Codex final readback and later connector verification. No feature change remains active. No V1/profile/login/Windows/tunnel alteration. This document is historical evidence, not an instruction to deploy the failed candidate.

## Functional problem and approach

- On Salla feedback, `browser_resize(1440,900)` returned success but the active page remained around `innerWidth=500`, `innerHeight=591`; desktop-only controls were hidden.
- Initial engine source used first `/json/list` page rather than proven active session target and acknowledged CDP emulation without readback.
- PR #5: https://github.com/FadiAboAlward/Fadi_Browser_v2/pull/5 — code added active tab `targetId` validation, actual `window.innerWidth/innerHeight` readback and explicit `VIEWPORT_MISMATCH` semantics; four new isolated test cases. Candidate initial direct ephemeral CDP WebSocket design was superseded: temporary CDP connection may lose override upon disconnect.
- Preserved candidate `1e55aad0641a5cb7f33394e0dcee6eb6435812b3` switched viewport operation to the **pinned agent-browser engine's `set viewport` command**, retaining active-tab membership verification and postcondition checks.
- Local syntax/focused engine tests: **8/8 PASS**. `npm test`: **64 PASS / 9 FAIL**, with same nine failures reproduced on preceding main. Those historical failures remain technical debt and must not be claimed fixed.
- Controlled local session tests at 1440×900 and 500×700 passed, preserving a background tab and separate session.
- **Live ChatGPT V2 connector acceptance FAILED:** repeated `ENGINE_COMMAND_FAILED / Invalid response: EOF while parsing a value` on both sizes after temporary local activation. Some readbacks reflected changed dimensions despite error; a throwing resize is **not** a pass. Deployment was rolled back and PR merge reverted with `3078b1815d1e5648dfb991460fbef900c77f134b` (main/source tree matches prior `1fad4f39eddefdbc4e41a9112faa75549de5e5c4`). Original fourteen tabs were preserved.
- Later bounded isolated investigation (synthetic profiles, separate namespace/ports): four paths all passed without EOF — native agent-browser CLI 1440×900, Node CLI wrapper 500×700, Broker HTTP 1440×900, local MCP HTTP 500×700. **This is NOT real ChatGPT connector acceptance**.
- Binary search/evidence: `Invalid response:` / `daemon may be busy or unresponsive` originates inside installed native `agent-browser` executable; engine wraps nonzero CLI exit as `ENGINE_COMMAND_FAILED` before its own JSON parser. Internal reason for empty response **not established** (possible intermittent daemon/transport/contention remains hypothesis).

## Next attempt: bounded only

1. Keep stable reverted V2 for ordinary supported tasks; avoid depending on desktop resize until verified.
2. Only if workflow is materially blocked, reproduce once **through the live ChatGPT connector**, preserve sanitized CLI stdout/stderr, engine exitCode, daemon response phase and timestamp/trace; compare with identical locally scoped call.
3. Find a small root-cause fix, then run focused + relevant regression checks and live 1440×900 + 500×700 acceptance in the *same owned tab* without modifying any background tab. **Do not merge or deploy before live result PASS.**
4. If EOF remains nonreproducible in a bounded test, defer. Avoid sweeping engine rewrite, timeout/retry tuning or OS changes without evidence.

## Sources

- PR discussion, code and rollback: https://github.com/FadiAboAlward/Fadi_Browser_v2/pull/5
- Codex local incident report `pr5-eof-diagnosis.md` (local report, *not automatically in Git*; summary recorded above).
- Earlier cross-tool latency / viewport brief: https://docs.google.com/document/d/19Dsz8hPKaHtyB01vFomoJvAJR53LWCIM6QvHITUly8M/edit
- Master engineering evidence: https://docs.google.com/document/d/1argPGCwaaB0kYwKFDtlp4dcpUbyK17wLgQjny9mhdB0/edit
- Improvement log: https://docs.google.com/spreadsheets/d/1gcUkX_mWf0Rf1jSjE0pSZAV6hok41U2Aq4sEtLa3lW8/edit (OBS-071).
