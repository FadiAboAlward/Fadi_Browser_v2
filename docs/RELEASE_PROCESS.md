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
