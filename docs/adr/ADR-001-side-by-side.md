# ADR-001: Run V2 Side by Side with V1

- Status: Accepted
- Date: 2026-09-21

## Context

The existing browser automation setup provides real operational value. V2 introduces a different allocation and identity model and therefore carries implementation risk.

Replacing V1 before V2 proves itself would increase downtime and rollback risk.

## Decision

Install and operate V2 independently during the validation period.

V2 receives separate:

- project and runtime directories;
- ports;
- MCP identity;
- services or tasks;
- logs;
- browser and auth state;
- broker database.

V2 must not mutate V1 configuration or profiles.

## Consequences

### Positive

- immediate rollback by simply using V1;
- clean A/B comparison;
- safe load testing;
- isolated failures;
- easier debugging.

### Negative

- temporary duplication of browser infrastructure;
- additional local resource usage;
- two operational paths during transition.

## Exit criterion

V2 may become the default only after sustained evidence demonstrates adequate:

- concurrency;
- isolation;
- auth persistence;
- stability;
- observability;
- resource usage;

and after explicit user approval.

Even after default change, removal of V1 should be a separate decision.
