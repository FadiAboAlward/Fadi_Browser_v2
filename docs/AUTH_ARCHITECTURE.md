# Authentication Architecture

## Goals

- persistent login identities;
- minimal repeated sign-in and MFA;
- isolated task sessions;
- deterministic identity selection;
- no secret leakage.

## Auth Profile

An auth profile represents one logical browser identity.

Public documentation uses generic names such as:

- auth-profile-a
- auth-profile-b

Real account identifiers stay local.

## Client mapping

A local policy may define default mappings:

client-a -> auth-profile-a

client-b -> auth-profile-b

A client may be allowed to request another identity only if local policy permits it.

## No identity fallback

If auth-profile-a is unavailable, the broker must not silently use auth-profile-b.

Return a structured auth error.

## Persistence

The implementation should use browser-engine-supported persistence or state restoration.

The exact strategy must preserve:

- cookies and state required for authentication;
- IndexedDB or storage where needed;
- safe encryption at rest when available.

It must avoid unsafe simultaneous ownership of one live profile directory.

### Implemented 0.1.0 policy

Persistent auth profiles map to encrypted agent-browser restore keys in the dedicated V2 namespace. Every task still receives a unique isolated session. The first active lease for a profile is its persistence writer; any simultaneous lease for the same profile loads the baseline with saving disabled. This prevents concurrent state-file writes and avoids sharing a live `user-data-dir`.

The encryption key is local-only and DPAPI-protected. Public sessions do not load or save auth state.

## OAuth

The agent should autonomously complete normal OAuth browser steps when:

- the task or integration was authorized by the user;
- required scopes are within that authorization;
- the provider supports normal browser interaction.

If the provider presents materially broader scopes than expected, stop and surface the difference rather than silently accepting scope expansion.

## MFA and OTP

MFA is an auth-profile health condition, not a generic browser failure.

Record only an event such as mfa_required = true.

Never log the code.

Once completed legitimately, preserve updated auth state.

## CAPTCHA

Do not implement bypass.

If challenge interaction cannot be completed normally by the agent:

- keep the exact session alive;
- ask for only the challenge completion;
- continue automatically after success.

## Health states

- READY
- REAUTH_REQUIRED
- MFA_REQUIRED
- BROKEN
- UNKNOWN

Health checks should avoid triggering security challenges unnecessarily.

## Rotation and revocation

If a provider invalidates state, reauthenticate that profile only.

Do not destroy unrelated profiles.
