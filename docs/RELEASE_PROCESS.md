# Release Process

## Versioning

Use Semantic Versioning for Fadi Browser V2 independently of the browser-engine version.

Record at startup:

- Fadi Browser V2 version;
- browser-engine version;
- telemetry schema version;
- config schema version.

## Pre-release gate

Before a release:

- tests pass;
- five-session isolation regression passes;
- no identity fallback;
- diagnostics sanitization passes;
- secret scan passes;
- V1 regression check passes;
- CHANGELOG updated;
- architecture docs and ADRs updated when needed.

## Performance-sensitive release

Also compare against baseline and document meaningful regressions or improvements.

## Rollback

Every release must be reversible.

The side-by-side design means operational rollback can always choose V1 while V2 is repaired.

Do not delete V1 as part of an ordinary V2 release.

The implemented deployment stores immutable source snapshots under `%LOCALAPPDATA%\FadiBrowserV2\deployments\<commit>` and records current, previous healthy, and running commit references under the V2 state directory. `rollback.ps1` only switches among validated V2 deployments and never touches V1.


## Proven deployment gate

The approved deployment path requires the exact approved commit to be contained in `origin/main`.

Do not bypass that guard.

Recommended sequence:

1. finish QA on a branch;
2. create an explicit final commit;
3. run secret scanning;
4. push the exact commit;
5. ensure that commit is contained in `origin/main`;
6. deploy the explicit approved commit;
7. verify the running commit equals the approved commit;
8. run the production smoke test;
9. verify clean release and zero active/queued sessions.

The initial production baseline deployed successfully from:

`1beadd42b7e964d54cc96853d4b920e644f2af85`

Documentation-only commits may later advance `main` without changing the deployed executable code. Operational tooling and incident reports must record the actual running commit explicitly rather than assuming it equals the latest documentation commit.
