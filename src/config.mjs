import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrokerError } from './errors.mjs';
import { ensureDir, expandWindowsEnv } from './util.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function defaultRuntimeRoot() {
  const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || process.cwd(), 'AppData', 'Local');
  return path.join(local, 'FadiBrowserV2');
}

export function loadConfig(options = {}) {
  const runtimeRoot = path.resolve(options.runtimeRoot || process.env.FADI_BROWSER_V2_RUNTIME_ROOT || defaultRuntimeRoot());
  const explicitPath = options.configPath || process.env.FADI_BROWSER_V2_CONFIG;
  const configPath = explicitPath || path.join(runtimeRoot, 'config', 'config.json');
  const fallbackPath = path.join(PROJECT_ROOT, 'config', 'config.example.json');
  const sourcePath = existsSync(configPath) ? configPath : fallbackPath;
  let raw;
  try {
    raw = JSON.parse(readFileSync(sourcePath, 'utf8'));
  } catch (error) {
    throw new BrokerError('CONFIG', 'CONFIG_READ_FAILED', `Cannot read configuration: ${error.message}`, { configPath: sourcePath }, 500);
  }

  const configuredRuntime = expandWindowsEnv(raw.runtimeRoot || runtimeRoot);
  const resolvedRoot = path.resolve(configuredRuntime === '%LOCALAPPDATA%\\FadiBrowserV2' ? runtimeRoot : configuredRuntime);
  const config = {
    ...raw,
    projectRoot: PROJECT_ROOT,
    configPath: sourcePath,
    runtimeRoot: resolvedRoot,
    host: raw.host || '127.0.0.1',
    port: Number(raw.port || 8951),
    maxConcurrentSessions: Number(raw.maxConcurrentSessions || 5),
    queueMaxDepth: Number(raw.queueMaxDepth || 10),
    queueWaitTimeoutMs: Number(raw.queueWaitTimeoutMs || 30000),
    maxSessionsPerClient: Number(raw.maxSessionsPerClient || 3),
    leaseTtlMs: Number(raw.leaseTtlMs || 300000),
    recoveryWindowMs: Number(raw.recoveryWindowMs || 120000),
    retentionDays: Number(raw.retentionDays || 30),
    headed: raw.headed === true,
    namespace: raw.namespace || 'fadi-browser-v2',
    clients: raw.clients || {},
    authProfiles: raw.authProfiles || {}
  };

  for (const [id, profile] of Object.entries(config.authProfiles)) {
    if (profile.headed !== undefined && typeof profile.headed !== 'boolean') {
      throw new BrokerError('CONFIG', 'INVALID_HEADED_MODE', `Auth profile ${id} must set headed to true or false.`, undefined, 500);
    }
    profile.mode = profile.mode || 'portable';
    if (!['portable', 'profile_bound'].includes(profile.mode)) {
      throw new BrokerError('CONFIG', 'INVALID_AUTH_MODE', `Auth profile ${id} has an invalid mode.`, undefined, 500);
    }
    if (profile.mode === 'profile_bound') {
      const ownedAuthRoot = path.resolve(resolvedRoot, 'auth');
      if (!profile.profilePath) {
        // Default: auto-derive a safe profilePath under the V2 auth root using the profile ID.
        // This allows a fresh config.json (copied from config.example.json) to start without
        // requiring the operator to manually add profilePath for every profile_bound profile.
        const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
        profile.profilePath = path.join(ownedAuthRoot, safeId);
      }
      const resolvedProfilePath = path.resolve(expandWindowsEnv(profile.profilePath));
      if (!resolvedProfilePath.startsWith(`${ownedAuthRoot}${path.sep}`) && resolvedProfilePath !== ownedAuthRoot) {
        throw new BrokerError('CONFIG', 'PROFILE_PATH_OUTSIDE_V2', `Profile-bound auth profile ${id} must use a path under the V2 runtime auth directory.`, undefined, 500);
      }
      profile.profilePath = resolvedProfilePath;
    }
    if (profile.externalChrome) {
      const external = profile.externalChrome;
      if (process.platform !== 'win32' || profile.mode !== 'profile_bound' || profile.headed !== true ||
          !Number.isInteger(external.cdpPort) || external.cdpPort < 1024 || external.cdpPort > 65535 ||
          [config.port, 8931, 8932, 8933, 8941, 8942, 8943].includes(external.cdpPort) ||
          typeof external.executablePath !== 'string' || !external.executablePath.trim()) {
        throw new BrokerError('CONFIG', 'INVALID_EXTERNAL_CHROME', `Auth profile ${id} has an invalid external Chrome configuration.`, undefined, 500);
      }
      external.executablePath = path.resolve(expandWindowsEnv(external.executablePath));
    }
  }

  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && config.host !== '::1') {
    throw new BrokerError('CONFIG', 'NON_LOOPBACK_BIND_DENIED', 'V2 must bind to loopback unless a separately reviewed remote deployment is configured.', { host: config.host }, 500);
  }
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    throw new BrokerError('CONFIG', 'INVALID_PORT', 'Configured port is invalid.', { port: config.port }, 500);
  }
  if (!Number.isInteger(config.maxConcurrentSessions) || config.maxConcurrentSessions < 1 || config.maxConcurrentSessions > 50) {
    throw new BrokerError('CONFIG', 'INVALID_CONCURRENCY_LIMIT', 'Configured concurrency limit must be between 1 and 50.', undefined, 500);
  }

  config.paths = {
    data: ensureDir(path.join(resolvedRoot, 'data')),
    logs: ensureDir(path.join(resolvedRoot, 'logs')),
    state: ensureDir(path.join(resolvedRoot, 'state')),
    auth: ensureDir(path.join(resolvedRoot, 'auth')),
    diagnostics: ensureDir(path.join(resolvedRoot, 'diagnostics')),
    qa: ensureDir(path.join(resolvedRoot, 'qa')),
    deployments: ensureDir(path.join(resolvedRoot, 'deployments'))
  };
  config.paths.sqlite = path.join(config.paths.data, 'telemetry.sqlite');
  config.paths.jsonl = path.join(config.paths.logs, 'events.jsonl');
  config.paths.pid = path.join(config.paths.state, 'broker.pid');
  config.paths.runningVersion = path.join(config.paths.state, 'running-version.json');
  config.paths.runningMarker = path.join(config.paths.state, 'broker-running.marker');

  return config;
}

export { PROJECT_ROOT };
