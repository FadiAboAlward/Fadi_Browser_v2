import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { nowIso, safeRef, sanitizeOrigin } from './util.mjs';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_SEGMENTS = 5;

export class Telemetry {
  constructor(config, versions = {}) {
    this.config = config;
    this.versions = versions;
    this.db = new DatabaseSync(config.paths.sqlite);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        broker_version TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        event_type TEXT NOT NULL,
        client_ref TEXT,
        auth_profile_ref TEXT,
        lease_ref TEXT,
        session_ref TEXT,
        operation TEXT,
        duration_ms REAL,
        success INTEGER,
        error_category TEXT,
        error_code TEXT,
        concurrency_count INTEGER,
        queue_wait_ms REAL,
        origin TEXT,
        cpu_user_us INTEGER,
        cpu_system_us INTEGER,
        memory_rss_bytes INTEGER,
        metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE TABLE IF NOT EXISTS leases (
        lease_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        client_id TEXT NOT NULL,
        auth_profile_id TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_activity TEXT NOT NULL,
        status TEXT NOT NULL,
        in_flight INTEGER NOT NULL DEFAULT 0,
        recovery_deadline TEXT,
        persistence_writer INTEGER NOT NULL DEFAULT 0,
        released_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_leases_status ON leases(status);
    `);
    this.insertEvent = this.db.prepare(`
      INSERT INTO events (
        timestamp, broker_version, engine_version, event_type, client_ref,
        auth_profile_ref, lease_ref, session_ref, operation, duration_ms,
        success, error_category, error_code, concurrency_count, queue_wait_ms,
        origin, cpu_user_us, cpu_system_us, memory_rss_bytes, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.cleanupRetention();
  }

  rotateIfNeeded() {
    if (!existsSync(this.config.paths.jsonl) || statSync(this.config.paths.jsonl).size < MAX_LOG_BYTES) return;
    const oldest = `${this.config.paths.jsonl}.${LOG_SEGMENTS}`;
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let i = LOG_SEGMENTS - 1; i >= 1; i -= 1) {
      const source = `${this.config.paths.jsonl}.${i}`;
      const target = `${this.config.paths.jsonl}.${i + 1}`;
      if (existsSync(source)) renameSync(source, target);
    }
    renameSync(this.config.paths.jsonl, `${this.config.paths.jsonl}.1`);
  }

  cleanupRetention() {
    const cutoff = new Date(Date.now() - this.config.retentionDays * 86400000).toISOString();
    this.db.prepare('DELETE FROM events WHERE timestamp < ?').run(cutoff);
  }

  event(eventType, data = {}) {
    const cpu = process.cpuUsage();
    const memory = process.memoryUsage();
    const record = {
      timestamp: nowIso(),
      broker_version: this.versions.brokerVersion || 'unknown',
      engine_version: this.versions.engineVersion || 'unknown',
      event_type: eventType,
      client_ref: safeRef(data.clientId),
      auth_profile_ref: safeRef(data.authProfileId),
      lease_ref: safeRef(data.leaseId),
      session_ref: safeRef(data.sessionId),
      operation: data.operation || null,
      duration_ms: Number.isFinite(data.durationMs) ? data.durationMs : null,
      success: data.success === undefined ? null : Boolean(data.success),
      error_category: data.errorCategory || null,
      error_code: data.errorCode || null,
      concurrency_count: Number.isFinite(data.concurrencyCount) ? data.concurrencyCount : null,
      queue_wait_ms: Number.isFinite(data.queueWaitMs) ? data.queueWaitMs : null,
      origin: sanitizeOrigin(data.url || data.origin),
      cpu_user_us: cpu.user,
      cpu_system_us: cpu.system,
      memory_rss_bytes: memory.rss,
      metadata: sanitizeMetadata(data.metadata || {})
    };
    this.insertEvent.run(
      record.timestamp, record.broker_version, record.engine_version, record.event_type,
      record.client_ref, record.auth_profile_ref, record.lease_ref, record.session_ref,
      record.operation, record.duration_ms, record.success === null ? null : Number(record.success),
      record.error_category, record.error_code, record.concurrency_count, record.queue_wait_ms,
      record.origin, record.cpu_user_us, record.cpu_system_us, record.memory_rss_bytes,
      JSON.stringify(record.metadata)
    );
    this.rotateIfNeeded();
    appendFileSync(this.config.paths.jsonl, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
    return record;
  }

  upsertLease(lease) {
    this.db.prepare(`
      INSERT INTO leases (
        lease_id, token_hash, client_id, auth_profile_id, session_id, created_at,
        last_activity, status, in_flight, recovery_deadline, persistence_writer, released_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(lease_id) DO UPDATE SET
        token_hash=excluded.token_hash,
        client_id=excluded.client_id,
        auth_profile_id=excluded.auth_profile_id,
        session_id=excluded.session_id,
        last_activity=excluded.last_activity,
        status=excluded.status,
        in_flight=excluded.in_flight,
        recovery_deadline=excluded.recovery_deadline,
        persistence_writer=excluded.persistence_writer,
        released_at=excluded.released_at
    `).run(
      lease.leaseId, lease.tokenHash, lease.clientId, lease.authProfileId, lease.sessionId,
      lease.createdAt, lease.lastActivity, lease.status, lease.inFlight,
      lease.recoveryDeadline || null, Number(Boolean(lease.persistenceWriter)), lease.releasedAt || null
    );
  }

  recoverableLeases() {
    return this.db.prepare("SELECT * FROM leases WHERE status IN ('ALLOCATING','ACTIVE','RELEASING','RECOVERABLE')").all();
  }

  close() {
    this.db.close();
  }
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeMetadata(item, depth + 1));
  if (typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:token|key|secret|password|code)=)[^&#\s]+/gi, '$1[REDACTED]');
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|otp|cookie|authorization|token|secret|credential|body|dom|page.?text/i.test(key)) {
      out[key] = '[REDACTED]';
    } else if (/url/i.test(key)) {
      out[key] = sanitizeOrigin(item);
    } else {
      out[key] = sanitizeMetadata(item, depth + 1);
    }
  }
  return out;
}

export function telemetryPaths(config) {
  return { sqlite: path.resolve(config.paths.sqlite), jsonl: path.resolve(config.paths.jsonl) };
}
