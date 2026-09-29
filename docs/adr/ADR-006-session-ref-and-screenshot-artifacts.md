# ADR-006 — Non-secret session references and screenshot artifact handoff

Status: Accepted  
Created: 2026-09-29 (KSA)

## Context

Browser V2 intentionally keeps normal model-facing browser actions free of credential-like lease tokens. That design is correct for the common single-session flow, but recent five-browser QA exposed two usability gaps:

1. a caller working with several owned sessions needs an explicit way to address one of its own sessions without depending only on implicit transport binding;
2. screenshots can be returned as MCP ImageContent, but remote report/file workflows still need a stable artifact handoff rather than a Windows-local path or manual base64 extraction.

The goal is to improve multi-session control and screenshot/report workflows without weakening server-side ownership checks or changing the Chrome engine architecture.

## Decision

### 1. Keep implicit binding as the default

Existing calls such as:

- browser_navigate({})
- browser_snapshot({})
- browser_screenshot({})

continue to operate on the session currently bound to the MCP task.

This preserves backward compatibility and the simplest single-session workflow.

### 2. Add an optional non-secret session_ref

For multi-session workflows, model-facing browser operations may accept an optional `session_ref`.

Properties:

- opaque and non-secret;
- not called token, credential, access_token, or lease_token;
- not sufficient for authorization by itself;
- ownership is always validated server-side against trusted client/task context;
- references owned by another client/task fail closed.

The internal lease credential remains private to the broker/administrative surface.

### 3. Keep lease_id/recovery_credential out of routine public actions

Do not require `lease_id`, lease tokens, or `recovery_credential` for ordinary navigation, screenshots, clicks, snapshots, or release.

A recovery credential remains dedicated to explicit recovery only.

### 4. Normalize screenshot metadata

`browser_screenshot` should return a stable structured metadata object together with MCP ImageContent.

Recommended metadata:

- ok
- browser_slot_id
- session_ref
- screenshot_id
- mime_type
- width
- height
- byte_size
- sha256
- local_path when useful for local diagnostics
- artifact/file reference when available

The local path is diagnostic only and must not be the sole remote handoff mechanism.

### 5. Add screenshot artifact retrieval

Provide a stable screenshot retrieval path, such as `browser_screenshot_get({ screenshot_id })`, that can return the same captured image without taking another screenshot.

Prefer MCP-native Resource/File references for portable handoff when supported by the host environment.

Do not add a new unauthenticated HTTP artifact server merely for convenience if an MCP-native reference is sufficient.

### 6. Report export is a bounded utility

A future `browser_export_report` may generate QA-oriented self-contained HTML from captured screenshots and metadata.

It is intentionally limited to browser QA/report export. Browser V2 should not become a general document-generation system.

### 7. Rich slot diagnostics

`browser_status` should expose safe per-slot operational metadata sufficient to diagnose a stuck BUSY slot, including where safe:

- browser_slot_id
- session_ref
- owner client alias/id
- session age
- process_id
- visible
- window_state
- high-level lease/session state

It must not expose private page content or secret credentials.

## Consequences

Benefits:

- multiple owned sessions can be addressed deterministically;
- screenshot-to-report workflows no longer depend on local Windows paths;
- debugging stuck slots becomes substantially easier;
- the existing single-session API remains simple and backward compatible.

Costs:

- MCP schemas become slightly richer;
- server-side ownership validation must cover explicit session_ref routing;
- artifact lifecycle/retention must be defined and tested.

## QA requirements

The change is release-blocking until automated and remote tests prove:

- implicit single-session behavior still works;
- explicit session_ref cannot cross ownership boundaries;
- five simultaneous sessions can be addressed independently;
- screenshot metadata maps to the correct browser slot/session;
- screenshot retrieval returns the original image;
- remote artifact/file handoff works without relying on a local Windows path;
- report export, if implemented, is self-contained;
- final release leaves zero active/queued sessions;
- V1 remains unaffected.
