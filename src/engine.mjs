import { spawn } from 'node:child_process';
import path from 'node:path';
import { BrokerError } from './errors.mjs';

export class AgentBrowserEngine {
  constructor(config, options = {}) {
    this.config = config;
    this.timeoutMs = options.timeoutMs || 60000;
    this.cliPath = options.cliPath || path.join(config.projectRoot, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js');
    this.environment = {
      ...process.env,
      AGENT_BROWSER_NAMESPACE: config.namespace,
      AGENT_BROWSER_STATE_EXPIRE_DAYS: String(config.retentionDays),
      AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
      AGENT_BROWSER_MAX_OUTPUT: '50000',
      AGENT_BROWSER_IDLE_TIMEOUT_MS: '0'
    };
  }

  async version() {
    const result = await this.#runRaw(['--version'], { sessionId: null, timeoutMs: 15000 });
    const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
    return match?.[1] || result.stdout.trim();
  }

  async createSession(sessionId, authProfileId, options = {}) {
    const flags = ['--pin-tab'];
    if (options.persistent) {
      flags.push('--restore', `auth-${authProfileId}`);
      flags.push('--restore-save', options.persistenceWriter ? 'always' : 'never');
    }
    return this.run(sessionId, ['open', 'about:blank'], { flags, timeoutMs: 90000 });
  }

  async navigate(sessionId, url) {
    return this.run(sessionId, ['open', url], { timeoutMs: 90000 });
  }

  async snapshot(sessionId, options = {}) {
    const args = ['snapshot'];
    if (options.interactive !== false) args.push('-i');
    if (options.compact) args.push('-c');
    if (Number.isInteger(options.depth)) args.push('-d', String(options.depth));
    return this.run(sessionId, args);
  }

  async getUrl(sessionId) {
    return this.run(sessionId, ['get', 'url']);
  }

  async getTitle(sessionId) {
    return this.run(sessionId, ['get', 'title']);
  }

  async wait(sessionId, milliseconds) {
    return this.run(sessionId, ['wait', String(milliseconds)], { timeoutMs: Math.max(this.timeoutMs, milliseconds + 10000) });
  }

  async evaluate(sessionId, script) {
    const encoded = Buffer.from(script, 'utf8').toString('base64');
    return this.run(sessionId, ['eval', '-b', encoded]);
  }

  async closeSession(sessionId) {
    return this.run(sessionId, ['close'], { timeoutMs: 30000 });
  }

  async sessionInfo(sessionId) {
    return this.run(sessionId, ['session', 'info']);
  }

  async run(sessionId, args, options = {}) {
    const globalArgs = ['--session', sessionId, '--namespace', this.config.namespace, '--json', ...(options.flags || [])];
    return this.#runRaw([...globalArgs, ...args], { sessionId, timeoutMs: options.timeoutMs, input: options.input });
  }

  #runRaw(args, options = {}) {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const child = spawn(process.execPath, [this.cliPath, ...args], {
        cwd: this.config.projectRoot,
        env: this.environment,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new BrokerError('TIMEOUT', 'AGENT_BROWSER_TIMEOUT', 'The browser engine operation timed out.', { session_ref: options.sessionId || null }, 504));
      }, options.timeoutMs || this.timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', error => {
        clearTimeout(timeout);
        reject(new BrokerError('AGENT_BROWSER', 'ENGINE_SPAWN_FAILED', error.message, undefined, 502));
      });
      // agent-browser launches a persistent daemon whose inherited stdio can keep
      // Node's `close` event pending after the short-lived CLI has exited. The
      // CLI exit code is the command completion boundary; waiting for `close`
      // incorrectly turns successful launches into 90-second timeouts.
      child.on('exit', code => {
        clearTimeout(timeout);
        const durationMs = Math.round((performance.now() - started) * 100) / 100;
        if (code !== 0) {
          reject(new BrokerError('AGENT_BROWSER', 'ENGINE_COMMAND_FAILED', safeEngineMessage(stderr || stdout), { exitCode: code, durationMs }, 502));
          return;
        }
        resolve({
          ok: true,
          durationMs,
          output: parseEngineOutput(stdout),
          raw: stdout.trim()
        });
      });
      if (options.input) child.stdin.end(options.input);
      else child.stdin.end();
    });
  }
}

function parseEngineOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  return { text: trimmed };
}

function safeEngineMessage(message) {
  const firstLine = String(message || 'agent-browser failed').split(/\r?\n/).find(Boolean) || 'agent-browser failed';
  return firstLine
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|key|secret|password|code)=)[^&#\s]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}
