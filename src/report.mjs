import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from './config.mjs';
import { percentile } from './util.mjs';

export function buildReport(config, days) {
  const db = new DatabaseSync(config.paths.sqlite, { readOnly: true });
  try {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const events = db.prepare('SELECT * FROM events WHERE timestamp >= ? ORDER BY timestamp').all(cutoff);
    const byType = type => events.filter(event => event.event_type === type);
    const sessionsRequested = byType('session_requested').length;
    const sessionsCreated = byType('session_created').filter(event => event.success === 1).length;
    const sessionFailures = events.filter(event => event.operation === 'browser_acquire' && event.success === 0).length;
    const sessionDurations = byType('session_created').map(event => Number(event.duration_ms)).filter(Number.isFinite);
    const toolDurations = events.filter(event => ['tool_completed', 'navigation_completed'].includes(event.event_type)).map(event => Number(event.duration_ms)).filter(Number.isFinite);
    const queueWaits = events.filter(event => event.queue_wait_ms !== null).map(event => Number(event.queue_wait_ms));
    const errors = events.filter(event => event.success === 0 && event.error_code);
    const group = (rows, key) => Object.fromEntries(Object.entries(rows.reduce((out, row) => {
      const value = row[key] || 'UNKNOWN';
      out[value] = (out[value] || 0) + 1;
      return out;
    }, {})).sort((a, b) => b[1] - a[1]));
    const mean = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : 0;
    return {
      generated_at: new Date().toISOString(),
      window_days: days,
      total_sessions: sessionsRequested,
      successful_sessions: sessionsCreated,
      failed_sessions: sessionFailures,
      failure_rate: sessionsRequested ? Math.round((sessionFailures / sessionsRequested) * 10000) / 10000 : 0,
      session_duration_ms: { average: mean(sessionDurations), p50: percentile(sessionDurations, 50), p95: percentile(sessionDurations, 95) },
      tool_latency_ms: { average: mean(toolDurations), p50: percentile(toolDurations, 50), p95: percentile(toolDurations, 95) },
      queue_wait_ms: { average: mean(queueWaits), p50: percentile(queueWaits, 50), p95: percentile(queueWaits, 95) },
      peak_concurrency: Math.max(0, ...events.map(event => Number(event.concurrency_count || 0))),
      browser_crashes: byType('browser_crashed').length,
      broker_restarts: byType('broker_started').length,
      auth_restore_success: byType('auth_restore_success').length,
      auth_restore_fail: byType('auth_restore_failed').length,
      mfa_events: byType('mfa_required').length,
      reauth_events: byType('reauth_required').length,
      stale_lease_cleanup: byType('session_reaped').length,
      resource_pressure: byType('resource_pressure').length,
      ownership_violations: events.filter(event => ['session_crossover_detected', 'tab_ownership_violation'].includes(event.event_type) && /"actual":true/.test(event.metadata_json || '')).length,
      blocked_ownership_attempts: events.filter(event => event.event_type === 'policy_denied' && event.error_code === 'LEASE_OWNER_MISMATCH').length,
      top_errors: group(errors, 'error_code'),
      errors_by_category: group(errors, 'error_category'),
      errors_by_version: group(errors, 'broker_version')
    };
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('report.mjs')) {
  const daysIndex = process.argv.indexOf('--days');
  const days = daysIndex >= 0 ? Number(process.argv[daysIndex + 1]) : 7;
  if (![1, 7, 14, 30].includes(days)) throw new Error('Days must be one of 1, 7, 14, or 30.');
  process.stdout.write(`${JSON.stringify(buildReport(loadConfig(), days), null, 2)}\n`);
}
