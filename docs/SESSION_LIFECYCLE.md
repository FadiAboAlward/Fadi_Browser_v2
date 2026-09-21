# Session Lifecycle

## State model

~~~mermaid
stateDiagram-v2
    [*] --> REQUESTED
    REQUESTED --> QUEUED: capacity full
    REQUESTED --> ALLOCATING: capacity available
    QUEUED --> ALLOCATING: slot available
    ALLOCATING --> ACTIVE: session ready
    ALLOCATING --> FAILED: allocation or auth failure
    ACTIVE --> RELEASING: normal release
    ACTIVE --> RECOVERABLE: safe recovery possible
    ACTIVE --> STALE: objective expiry or orphan rule
    RECOVERABLE --> ACTIVE: ownership proven
    RECOVERABLE --> STALE: recovery window expired
    STALE --> REAPING
    RELEASING --> CLOSED
    REAPING --> CLOSED
    FAILED --> CLOSED
    CLOSED --> [*]
~~~

## Acquire

Input should identify:

- client;
- requested or default auth profile;
- task metadata safe to log.

Output should include:

- opaque lease token;
- session identifier where appropriate;
- auth profile alias safe for caller;
- status.

## Use

Every browser operation must include or unambiguously resolve the lease.

The broker verifies:

- lease active;
- caller authorized;
- session owned;
- auth identity matches;
- no conflicting owner.

## Release

Release should:

- prevent new operations;
- wait for or cancel in-flight operations safely;
- close transient browser and session resources;
- persist only approved auth state;
- mark lease closed;
- emit telemetry.

## Stale cleanup

Stale reclamation must be objective, not based on a session merely looking idle.

Examples:

- lease expired;
- owning process or transport gone;
- recovery window elapsed;
- no in-flight operations.

Healthy and recoverable work must not be reaped.

## Recovery

Recovery is optional and must fail closed.

A caller must prove ownership with the correct recovery or lease credential.

Never recover by simply selecting the only browser that seems active.

## Capacity

Initial target: 5.

Capacity-full behavior should be explicit:

- bounded queue; or
- structured capacity error.

Track queue wait in telemetry.
