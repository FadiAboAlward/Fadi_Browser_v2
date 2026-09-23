import { randomUUID, timingSafeEqual } from 'node:crypto';
import { BrokerError, asBrokerError } from './errors.mjs';
import { newOpaqueToken, nowIso, safeRef, sanitizeOrigin, sha256 } from './util.mjs';
import { LeaseQueue } from './queue.mjs';

const CAPACITY_STATUSES = new Set(['ALLOCATING', 'ACTIVE', 'RECOVERABLE', 'RELEASING']);

export class LeaseBroker {
  constructor(config, telemetry, engine, versions = {}) {
    this.config = config;
    this.telemetry = telemetry;
    this.engine = engine;
    this.versions = versions;
    this.leases = new Map();
    this.tokenIndex = new Map();
    this.queuePumping = false;
    this.queue = new LeaseQueue(config, telemetry, { onChange: () => void this.#pumpQueue() });
    this.startedAt = nowIso();
    this.recentCrash = Boolean(versions.recentCrash);
    this.resourcePressure = false;
    this.#restoreLeases();
    this.sweeper = setInterval(() => void this.reapStale(), 5000);
    this.sweeper.unref?.();
    this.telemetry.event('broker_started', { concurrencyCount: this.activeCount() });
  }

  #restoreLeases() {
    const deadline = new Date(Date.now() + this.config.recoveryWindowMs).toISOString();
    for (const row of this.telemetry.recoverableLeases()) {
      const lease = {
        leaseId: row.lease_id,
        tokenHash: row.token_hash,
        clientId: row.client_id,
        authProfileId: row.auth_profile_id,
        sessionId: row.session_id,
        createdAt: row.created_at,
        lastActivity: row.last_activity,
        status: 'RECOVERABLE',
        inFlight: 0,
        recoveryDeadline: deadline,
        persistenceWriter: Boolean(row.persistence_writer),
        browserDiagnostics: null,
        releasedAt: null
      };
      this.leases.set(lease.leaseId, lease);
      this.tokenIndex.set(lease.tokenHash, lease.leaseId);
      this.telemetry.upsertLease(lease);
    }
  }

  activeCount() {
    return [...this.leases.values()].filter(lease => CAPACITY_STATUSES.has(lease.status)).length;
  }

  async acquire({ clientId, authProfileId, taskLabel, waitTimeoutMs, signal, _queueWaitMs = 0, _fromQueue = false }) {
    const started = performance.now();
    const resolvedProfile = this.#resolvePolicy(clientId, authProfileId);
    if (_queueWaitMs === 0) {
      this.telemetry.event('session_requested', {
        clientId,
        authProfileId: resolvedProfile,
        concurrencyCount: this.activeCount(),
        queueWaitMs: 0,
        metadata: { task_label: taskLabel ? String(taskLabel).slice(0, 80) : null }
      });
    }

    const clientActive = this.#clientActiveCount(clientId);
    const maxClient = this.config.maxSessionsPerClient ?? 3;
    const profileBusy = this.#isProfileBusy(resolvedProfile);
    const blocked = this.activeCount() >= this.config.maxConcurrentSessions
      || clientActive >= maxClient
      || profileBusy;

    if (blocked) {
      if (_fromQueue) {
        throw new BrokerError('BROKER', 'QUEUE_PROMOTION_RACE', 'A queued request could not claim its reserved capacity.', undefined, 503);
      }
      // Only queue when caller explicitly opts in with waitTimeoutMs > 0
      if (waitTimeoutMs > 0) {
        try {
          const queued = this.queue.enqueue({ clientId, authProfileId: resolvedProfile, taskLabel, waitTimeoutMs, signal });
          return await queued.promise;
        } catch (error) {
          this.telemetry.event('tool_failed', {
            clientId,
            authProfileId: resolvedProfile,
            operation: 'browser_acquire',
            success: false,
            errorCategory: error.category || 'RESOURCE',
            errorCode: error.code || 'QUEUE_FAILED',
            concurrencyCount: this.activeCount(),
            queueWaitMs: _queueWaitMs + Math.round(performance.now() - started)
          });
          throw error;
        }
      }
      // Immediate rejection with the most specific error
      const rejectCode = profileBusy ? 'AUTH_PROFILE_BUSY'
        : clientActive >= maxClient ? 'PER_CLIENT_LIMIT'
        : 'CAPACITY_EXHAUSTED';
      const rejectMsg = profileBusy ? 'The requested profile is bound and currently in use.'
        : clientActive >= maxClient ? `Client already has ${clientActive} active sessions (limit: ${maxClient}).`
        : 'All configured V2 session slots are in use.';
      this.telemetry.event('tool_failed', {
        clientId,
        authProfileId: resolvedProfile,
        operation: 'browser_acquire',
        success: false,
        errorCategory: 'RESOURCE',
        errorCode: rejectCode,
        concurrencyCount: this.activeCount(),
        queueWaitMs: _queueWaitMs
      });
      throw new BrokerError('RESOURCE', rejectCode, rejectMsg, {
        active: this.activeCount(),
        limit: this.config.maxConcurrentSessions,
        client_active: clientActive,
        client_limit: maxClient,
        queue_wait_ms: _queueWaitMs
      }, profileBusy ? 409 : 429);
    }

    const leaseToken = newOpaqueToken();
    const lease = {
      leaseId: randomUUID(),
      tokenHash: sha256(leaseToken),
      clientId,
      authProfileId: resolvedProfile,
      sessionId: `v2-${randomUUID().replaceAll('-', '')}`,
      createdAt: nowIso(),
      lastActivity: nowIso(),
      status: 'ALLOCATING',
      inFlight: 0,
      recoveryDeadline: null,
      persistenceWriter: this.#isPersistenceWriter(resolvedProfile),
      browserDiagnostics: null,
      releasedAt: null
    };
    this.leases.set(lease.leaseId, lease);
    this.tokenIndex.set(lease.tokenHash, lease.leaseId);
    this.telemetry.upsertLease(lease);
    this.telemetry.event('lease_created', this.#eventContext(lease, { concurrencyCount: this.activeCount(), queueWaitMs: 0 }));
    try {
      const profile = this.config.authProfiles[resolvedProfile];
      if (profile?.persistent) {
        this.telemetry.event('auth_restore_started', this.#eventContext(lease, {
          operation: 'auth_restore',
          metadata: { persistence_writer: lease.persistenceWriter }
        }));
      }
      const created = await this.engine.createSession(lease.sessionId, resolvedProfile, {
        persistent: Boolean(profile?.persistent),
        persistenceWriter: lease.persistenceWriter,
        mode: profile?.mode || 'portable',
        profilePath: profile?.profilePath,
        externalChrome: profile?.externalChrome,
        validation: profile?.validation,
        startUrl: profile?.validation?.startUrl,
        headed: profile?.headed ?? this.config.headed
      });
      lease.browserDiagnostics = created?.diagnostics || null;
      if (profile?.persistent) {
        this.telemetry.event('auth_restore_success', this.#eventContext(lease, {
          operation: 'auth_restore',
          success: true,
          metadata: { persistence_writer: lease.persistenceWriter }
        }));
      }
      lease.status = 'ACTIVE';
      lease.lastActivity = nowIso();
      this.telemetry.upsertLease(lease);
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      this.telemetry.event('session_created', this.#eventContext(lease, {
        durationMs,
        success: true,
        concurrencyCount: this.activeCount(),
        queueWaitMs: _queueWaitMs,
        windowState: lease.browserDiagnostics?.window_state,
        windowVisible: lease.browserDiagnostics?.visible,
        browserProcessId: lease.browserDiagnostics?.process_id,
        metadata: { persistence_writer: lease.persistenceWriter }
      }));
      this.telemetry.event('window_state_observed', this.#eventContext(lease, {
        success: true,
        windowState: lease.browserDiagnostics?.window_state,
        windowVisible: lease.browserDiagnostics?.visible,
        browserProcessId: lease.browserDiagnostics?.process_id,
        metadata: { safe_window_id: lease.browserDiagnostics?.safe_window_id || null }
      }));
      return {
        lease_id: lease.leaseId,
        lease_token: leaseToken,
        session_id: lease.sessionId,
        client_id: lease.clientId,
        auth_profile_id: lease.authProfileId,
        created_at: lease.createdAt,
        last_activity: lease.lastActivity,
        status: lease.status,
        queue_wait_ms: _queueWaitMs
      };
    } catch (error) {
      lease.status = 'CLOSED';
      lease.releasedAt = nowIso();
      this.telemetry.upsertLease(lease);
      this.tokenIndex.delete(lease.tokenHash);
      const failure = asBrokerError(error, 'AGENT_BROWSER', 'SESSION_CREATE_FAILED');
      if (this.config.authProfiles[resolvedProfile]?.persistent) {
        this.telemetry.event('auth_restore_failed', this.#eventContext(lease, {
          operation: 'auth_restore',
          success: false,
          errorCategory: failure.category,
          errorCode: failure.code
        }));
      }
      this.telemetry.event('tool_failed', this.#eventContext(lease, {
        operation: 'browser_acquire',
        success: false,
        errorCategory: failure.category,
        errorCode: failure.code,
        concurrencyCount: this.activeCount()
      }));
      throw failure;
    }
  }

  status({ clientId, leaseToken } = {}) {
    if (leaseToken) {
      const lease = this.#leaseByToken(leaseToken);
      if (clientId && lease.clientId !== clientId) this.#ownershipViolation(lease, clientId);
      return this.#publicLease(lease);
    }
    const authProfiles = Object.fromEntries(Object.entries(this.config.authProfiles).map(([id, profile]) => [id, {
      configured: true,
      persistent: Boolean(profile.persistent),
      auth_mode: profile.mode || 'portable',
      concurrent_allowed: profile.mode !== 'profile_bound',
      known_good_policy: profile.mode === 'portable' && profile.persistent ? 'engine_auto_validation' : null,
      active_sessions: [...this.leases.values()].filter(lease => lease.authProfileId === id && CAPACITY_STATUSES.has(lease.status)).length
    }]));
    return {
      broker: 'HEALTHY',
      mcp: 'HEALTHY',
      browser_engine: 'HEALTHY',
      sessions_active: this.activeCount(),
      sessions_queued: this.queue.length,
      concurrency_limit: this.config.maxConcurrentSessions,
      auth_profiles: authProfiles,
      recent_crash: this.recentCrash,
      resource_pressure: this.resourcePressure,
      project_version: this.versions.brokerVersion || 'unknown',
      engine_version: this.versions.engineVersion || 'unknown',
      running_commit: this.versions.runningCommit || 'unknown',
      source_dirty: Boolean(this.versions.sourceDirty),
      started_at: this.startedAt
    };
  }

  cancelQueue({ clientId, queueId }) {
    const entry = this.queue.entries.find(item => item.id === queueId);
    if (!entry) throw new BrokerError('RESOURCE', 'QUEUE_ENTRY_NOT_FOUND', 'The queue entry is no longer active.', undefined, 404);
    if (entry.clientId !== clientId) {
      throw new BrokerError('POLICY', 'QUEUE_OWNER_MISMATCH', 'The queue entry belongs to a different client.', undefined, 403);
    }
    this.queue.cancel(queueId);
    return { acquisition_state: 'CANCELLED', queue_id: queueId };
  }

  async recover({ clientId, leaseToken }) {
    const lease = this.#leaseByToken(leaseToken);
    if (lease.clientId !== clientId) this.#ownershipViolation(lease, clientId);
    if (lease.status !== 'RECOVERABLE') {
      throw new BrokerError('LEASE', 'NOT_RECOVERABLE', 'This lease is not in a recoverable state.', { status: lease.status }, 409);
    }
    if (!lease.recoveryDeadline || Date.now() > Date.parse(lease.recoveryDeadline)) {
      throw new BrokerError('LEASE', 'RECOVERY_WINDOW_EXPIRED', 'The lease recovery window has expired.', undefined, 410);
    }
    const profile = this.config.authProfiles[lease.authProfileId];
    this.engine.setSessionHeaded?.(lease.sessionId, profile?.headed ?? this.config.headed);
    try {
      await this.engine.sessionInfo(lease.sessionId);
    } catch {
      const created = await this.engine.createSession(lease.sessionId, lease.authProfileId, {
        persistent: Boolean(profile?.persistent),
        persistenceWriter: lease.persistenceWriter,
        mode: profile?.mode || 'portable',
        profilePath: profile?.profilePath,
        validation: profile?.validation,
        startUrl: profile?.validation?.startUrl,
        headed: profile?.headed ?? this.config.headed
      });
      lease.browserDiagnostics = created?.diagnostics || null;
      this.telemetry.event('session_restored', this.#eventContext(lease, { success: true }));
    }
    lease.status = 'ACTIVE';
    lease.recoveryDeadline = null;
    lease.lastActivity = nowIso();
    this.telemetry.upsertLease(lease);
    this.telemetry.event('lease_recovered', this.#eventContext(lease, { success: true, concurrencyCount: this.activeCount() }));
    return this.#publicLease(lease);
  }

  async release({ clientId, leaseToken, reason = 'explicit' }) {
    const lease = this.#leaseByToken(leaseToken);
    if (lease.clientId !== clientId) this.#ownershipViolation(lease, clientId);
    return this.#closeLease(lease, reason);
  }

  async #closeLease(lease, reason) {
    if (lease.status === 'CLOSED') return this.#publicLease(lease);
    if (lease.inFlight > 0) {
      throw new BrokerError('LEASE', 'LEASE_IN_FLIGHT', 'The lease has an operation in flight and cannot be released.', undefined, 409);
    }
    lease.status = 'RELEASING';
    this.telemetry.upsertLease(lease);
    try {
      await this.engine.closeSession(lease.sessionId);
    } catch (error) {
      const failure = asBrokerError(error, 'AGENT_BROWSER', 'SESSION_CLOSE_FAILED');
      this.telemetry.event('browser_crashed', this.#eventContext(lease, {
        success: false,
        errorCategory: failure.category,
        errorCode: failure.code
      }));
    }
    lease.status = 'CLOSED';
    lease.releasedAt = nowIso();
    lease.lastActivity = lease.releasedAt;
    this.telemetry.upsertLease(lease);
    this.tokenIndex.delete(lease.tokenHash);
    this.telemetry.event('session_released', this.#eventContext(lease, {
      success: true,
      concurrencyCount: this.activeCount(),
      metadata: { reason }
    }));
    void this.#pumpQueue();
    return this.#publicLease(lease);
  }

  async navigate({ clientId, leaseToken, url }) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new BrokerError('POLICY', 'INVALID_URL', 'Navigation URL is invalid.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BrokerError('POLICY', 'UNSUPPORTED_URL_SCHEME', 'Only HTTP and HTTPS navigation is allowed through the broker.');
    }
    return this.#withLease(clientId, leaseToken, 'navigate', () => this.engine.navigate(this.#leaseByToken(leaseToken).sessionId, url), { url });
  }

  async snapshot({ clientId, leaseToken, interactive = true, compact = false, depth }) {
    return this.#withLease(clientId, leaseToken, 'snapshot', lease => this.engine.snapshot(lease.sessionId, { interactive, compact, depth }));
  }

  async getUrl({ clientId, leaseToken }) {
    return this.#withLease(clientId, leaseToken, 'get_url', lease => this.engine.getUrl(lease.sessionId));
  }

  async getTitle({ clientId, leaseToken }) {
    return this.#withLease(clientId, leaseToken, 'get_title', lease => this.engine.getTitle(lease.sessionId));
  }

  async evaluate({ clientId, leaseToken, script }) {
    if (typeof script !== 'string' || script.length > 50000) throw new BrokerError('POLICY', 'INVALID_SCRIPT', 'Evaluate script must be a string up to 50,000 characters.');
    return this.#withLease(clientId, leaseToken, 'evaluate', lease => this.engine.evaluate(lease.sessionId, script));
  }

  async command({ clientId, leaseToken, command, args = [] }) {
    const allowed = new Set(['click', 'fill', 'type', 'press', 'wait', 'tab', 'back', 'forward', 'reload', 'hover', 'focus', 'check', 'uncheck', 'select', 'scroll', 'scrollintoview']);
    if (!allowed.has(command)) throw new BrokerError('POLICY', 'COMMAND_NOT_ALLOWED', 'This command is not exposed by the lease broker.', { command }, 403);
    if (!Array.isArray(args) || args.length > 20 || args.some(item => typeof item !== 'string' || item.length > 10000)) {
      throw new BrokerError('POLICY', 'INVALID_COMMAND_ARGUMENTS', 'Command arguments are invalid.');
    }
    return this.#withLease(clientId, leaseToken, command, lease => this.engine.run(lease.sessionId, [command, ...args]));
  }

  async restoreWindow({ clientId, leaseToken }) {
    return this.#withLease(clientId, leaseToken, 'restore_window', async lease => {
      const diagnostics = await this.engine.restoreWindow(lease.sessionId);
      lease.browserDiagnostics = diagnostics;
      this.telemetry.event('window_restored', this.#eventContext(lease, {
        success: true,
        windowState: diagnostics.window_state,
        windowVisible: diagnostics.visible,
        browserProcessId: diagnostics.process_id,
        metadata: { safe_window_id: diagnostics.safe_window_id }
      }));
      return diagnostics;
    });
  }

  async reapStale() {
    const now = Date.now();
    let reaped = false;
    for (const lease of [...this.leases.values()]) {
      if (lease.inFlight > 0 || !CAPACITY_STATUSES.has(lease.status)) continue;
      const activeExpired = lease.status === 'ACTIVE' && now - Date.parse(lease.lastActivity) > this.config.leaseTtlMs;
      const recoveryExpired = lease.status === 'RECOVERABLE' && lease.recoveryDeadline && now > Date.parse(lease.recoveryDeadline);
      if (!activeExpired && !recoveryExpired) continue;
      this.telemetry.event('lease_expired', this.#eventContext(lease, { success: true }));
      try { await this.engine.closeSession(lease.sessionId); } catch {}
      lease.status = 'CLOSED';
      lease.releasedAt = nowIso();
      this.tokenIndex.delete(lease.tokenHash);
      this.telemetry.upsertLease(lease);
      this.telemetry.event('session_reaped', this.#eventContext(lease, { success: true, concurrencyCount: this.activeCount() }));
      reaped = true;
    }
    if (reaped) void this.#pumpQueue();
  }

  async shutdown({ preserveRecoverable = false } = {}) {
    clearInterval(this.sweeper);
    this.queue.drain();
    if (preserveRecoverable) {
      const deadline = new Date(Date.now() + this.config.recoveryWindowMs).toISOString();
      for (const lease of this.leases.values()) {
        if (lease.status === 'ACTIVE') {
          lease.status = 'RECOVERABLE';
          lease.recoveryDeadline = deadline;
          lease.inFlight = 0;
          this.telemetry.upsertLease(lease);
        }
      }
    } else {
      for (const lease of [...this.leases.values()]) {
        if (CAPACITY_STATUSES.has(lease.status) && lease.inFlight === 0) {
          await this.#closeLease(lease, 'broker_shutdown').catch(async () => {
            try { await this.engine.closeSession(lease.sessionId); } catch {}
            lease.status = 'CLOSED';
            lease.releasedAt = nowIso();
            this.tokenIndex.delete(lease.tokenHash);
            this.telemetry.upsertLease(lease);
          });
        }
      }
    }
    this.telemetry.event('broker_stopped', { concurrencyCount: this.activeCount(), metadata: { preserve_recoverable: preserveRecoverable } });
  }

  async #withLease(clientId, leaseToken, operation, fn, context = {}) {
    const lease = this.#leaseByToken(leaseToken);
    if (lease.clientId !== clientId) this.#ownershipViolation(lease, clientId);
    if (lease.status !== 'ACTIVE') {
      throw new BrokerError('LEASE', 'LEASE_NOT_ACTIVE', 'The lease is not active.', { status: lease.status }, 409);
    }
    lease.inFlight += 1;
    lease.lastActivity = nowIso();
    this.telemetry.upsertLease(lease);
    const started = performance.now();
    this.telemetry.event('tool_started', this.#eventContext(lease, { operation, concurrencyCount: this.activeCount(), ...context }));
    try {
      const result = await fn(lease);
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      this.telemetry.event(operation === 'navigate' ? 'navigation_completed' : 'tool_completed', this.#eventContext(lease, {
        operation,
        durationMs,
        success: true,
        concurrencyCount: this.activeCount(),
        ...context
      }));
      return result;
    } catch (error) {
      const failure = asBrokerError(error, 'AGENT_BROWSER', 'TOOL_FAILED');
      const durationMs = Math.round((performance.now() - started) * 100) / 100;
      this.telemetry.event(operation === 'navigate' ? 'navigation_failed' : 'tool_failed', this.#eventContext(lease, {
        operation,
        durationMs,
        success: false,
        errorCategory: failure.category,
        errorCode: failure.code,
        concurrencyCount: this.activeCount(),
        ...context
      }));
      throw failure;
    } finally {
      lease.inFlight = Math.max(0, lease.inFlight - 1);
      lease.lastActivity = nowIso();
      this.telemetry.upsertLease(lease);
    }
  }

  #resolvePolicy(clientId, requestedProfile) {
    if (!clientId || !this.config.clients[clientId]) {
      this.telemetry.event('policy_denied', { clientId, authProfileId: requestedProfile, success: false, errorCategory: 'POLICY', errorCode: 'UNKNOWN_CLIENT' });
      throw new BrokerError('POLICY', 'UNKNOWN_CLIENT', 'Client is not configured in local policy.', undefined, 403);
    }
    const policy = this.config.clients[clientId];
    const profile = requestedProfile || policy.defaultAuthProfile;
    if (!profile || !this.config.authProfiles[profile]) {
      throw new BrokerError('AUTH', 'AUTH_PROFILE_UNAVAILABLE', 'The requested/default auth profile is not configured.', undefined, 403);
    }
    if (!Array.isArray(policy.allowedAuthProfiles) || !policy.allowedAuthProfiles.includes(profile)) {
      this.telemetry.event('policy_denied', { clientId, authProfileId: profile, success: false, errorCategory: 'POLICY', errorCode: 'AUTH_PROFILE_DENIED' });
      throw new BrokerError('POLICY', 'AUTH_PROFILE_DENIED', 'Client is not allowed to use the requested auth profile.', undefined, 403);
    }
    return profile;
  }

  async #pumpQueue() {
    if (this.queuePumping) return;
    this.queuePumping = true;
    try {
      while (this.queue.length > 0 && this.activeCount() < this.config.maxConcurrentSessions) {
        const entry = this.queue.takeHead(head => {
          const clientActive = this.#clientActiveCount(head.clientId);
          const maxClient = this.config.maxSessionsPerClient ?? 3;
          return clientActive < maxClient && !this.#isProfileBusy(head.authProfileId);
        });
        // Strict FIFO: an ineligible head is never bypassed by a later request.
        if (!entry) break;
        const queueWaitMs = Date.now() - entry.enqueuedAt;
        try {
          const lease = await this.acquire({
            clientId: entry.clientId,
            authProfileId: entry.authProfileId,
            taskLabel: entry.taskLabel,
            waitTimeoutMs: 0,
            _queueWaitMs: queueWaitMs,
            _fromQueue: true
          });
          this.queue.resolve(entry, {
            ...lease,
            acquisition_state: 'ACQUIRED',
            queue_id: entry.id,
            queue_position: entry.initialPosition,
            wait_timeout_ms: entry.waitTimeoutMs
          });
        } catch (error) {
          entry.reject(error);
        }
      }
    } finally {
      this.queuePumping = false;
    }
  }

  #clientActiveCount(clientId) {
    return [...this.leases.values()].filter(lease => lease.clientId === clientId && CAPACITY_STATUSES.has(lease.status)).length;
  }

  #isProfileBusy(authProfileId) {
    const profile = this.config.authProfiles[authProfileId];
    if (profile?.mode !== 'profile_bound') return false;
    return [...this.leases.values()].some(lease => lease.authProfileId === authProfileId && CAPACITY_STATUSES.has(lease.status));
  }

  #isPersistenceWriter(authProfileId) {
    if (!this.config.authProfiles[authProfileId]?.persistent) return false;
    return ![...this.leases.values()].some(lease => lease.authProfileId === authProfileId && CAPACITY_STATUSES.has(lease.status));
  }

  #leaseByToken(token) {
    if (typeof token !== 'string' || token.length < 32) throw new BrokerError('LEASE', 'INVALID_LEASE_TOKEN', 'Lease token is missing or invalid.', undefined, 401);
    const tokenHash = sha256(token);
    const leaseId = this.tokenIndex.get(tokenHash);
    if (!leaseId) throw new BrokerError('LEASE', 'INVALID_LEASE_TOKEN', 'Lease token is expired, closed, or unknown.', undefined, 401);
    const lease = this.leases.get(leaseId);
    const actual = Buffer.from(tokenHash, 'hex');
    const expected = Buffer.from(lease.tokenHash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new BrokerError('LEASE', 'INVALID_LEASE_TOKEN', 'Lease token is invalid.', undefined, 401);
    return lease;
  }

  #ownershipViolation(lease, attemptedClientId) {
    this.telemetry.event('policy_denied', this.#eventContext(lease, {
      success: false,
      errorCategory: 'LEASE',
      errorCode: 'LEASE_OWNER_MISMATCH',
      metadata: { attempted_client_ref: safeRef(attemptedClientId), prevented: true }
    }));
    throw new BrokerError('LEASE', 'LEASE_OWNER_MISMATCH', 'The lease belongs to a different client.', undefined, 403);
  }

  #eventContext(lease, extra = {}) {
    return {
      clientId: lease.clientId,
      authProfileId: lease.authProfileId,
      leaseId: lease.leaseId,
      sessionId: lease.sessionId,
      ...extra
    };
  }

  #publicLease(lease) {
    return {
      lease_id: lease.leaseId,
      client_id: lease.clientId,
      auth_profile_id: lease.authProfileId,
      session_id: lease.sessionId,
      created_at: lease.createdAt,
      last_activity: lease.lastActivity,
      status: lease.status,
      in_flight_operations: lease.inFlight,
      recovery_deadline: lease.recoveryDeadline,
      persistence_writer: lease.persistenceWriter,
      browser: lease.browserDiagnostics
    };
  }
}
