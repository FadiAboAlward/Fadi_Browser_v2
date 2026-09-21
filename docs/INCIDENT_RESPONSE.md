# Incident Response

## Severity guidance

### Critical

- session crossover;
- wrong auth identity used;
- secret exposure;
- V2 modifies or damages V1;
- uncontrolled browser ownership.

### High

- repeated browser crashes;
- repeated auth corruption;
- persistent inability to release leases;
- diagnostics leaking sensitive data.

### Medium

- latency regression;
- resource pressure;
- sporadic navigation failures.

## Critical isolation incident

1. Stop new V2 allocations.
2. Preserve sanitized telemetry.
3. Do not delete evidence.
4. Confirm V1 remains unaffected.
5. Identify affected lease, session, client, and auth profile.
6. Reconstruct event timeline.
7. Fix root cause and add a regression test.
8. Run full concurrency QA before resuming.

## Secret incident

1. Revoke or rotate affected secret.
2. Remove exposure path.
3. Inspect Git history and logs.
4. Add prevention control.
5. Document the event without repeating the secret.

## Recovery principle

Prefer reversible actions.

Do not wipe all profiles or state as a first response unless evidence proves that broad reset is required.
