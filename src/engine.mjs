import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BrokerError } from './errors.mjs';

export class AgentBrowserEngine {
  constructor(config, options = {}) {
    this.config = config;
    this.timeoutMs = options.timeoutMs || 60000;
    this.cliPath = options.cliPath || path.join(config.projectRoot, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js');
    this.sessionHeaded = new Map();
    this.sessionNamespaces = new Map();
    this.externalSessions = new Map();
    this.ensureExternalChrome = options.ensureExternalChrome || ensureExternalChrome;
    this.inspectExternalChrome = options.inspectExternalChrome || inspectExternalChrome;
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
    this.setSessionHeaded(sessionId, options.headed);
    const flags = ['--pin-tab'];
    if (options.externalChrome) {
      if (options.mode !== 'profile_bound' || !options.profilePath || !options.headed) {
        throw new BrokerError('CONFIG', 'INVALID_EXTERNAL_CHROME', 'External Chrome requires a headed, profile-bound identity.', undefined, 500);
      }
      try {
        await this.ensureExternalChrome(options.externalChrome, options.profilePath);
      } catch (error) {
        this.sessionHeaded.delete(sessionId);
        throw error;
      }
      // agent-browser keeps browser launch state per namespace. Do not attach an
      // external profile through the namespace used by engine-owned sessions.
      this.sessionNamespaces.set(sessionId, `${this.config.namespace}-${authProfileId}-external-cdp`);
      this.externalSessions.set(sessionId, { ...options.externalChrome, profilePath: options.profilePath });
    } else if (options.mode === 'profile_bound') {
      if (!options.profilePath) {
        throw new BrokerError('AUTH', 'PROFILE_PATH_REQUIRED', 'A profile-bound identity requires a dedicated V2 profile path.', undefined, 500);
      }
      flags.push('--profile', options.profilePath);
    } else if (options.persistent) {
      flags.push('--restore', `auth-${authProfileId}`);
      // The engine's auto policy preserves the previous known-good state when
      // restore or validation fails. Concurrent readers never write state.
      flags.push('--restore-save', options.persistenceWriter ? 'auto' : 'never');
      if (options.validation?.url) flags.push('--restore-check-url', options.validation.url);
      if (options.validation?.text) flags.push('--restore-check-text', options.validation.text);
      if (options.validation?.fn) flags.push('--restore-check-fn', options.validation.fn);
    }
    let opened;
    try {
      // Attaching must not replace the human's current page with about:blank.
      if (options.externalChrome) {
        await this.run(sessionId, ['connect', String(options.externalChrome.cdpPort)], { flags, timeoutMs: 90000 });
        await this.#verifyExternalTargets(sessionId, options.externalChrome.cdpPort);
        opened = await this.getUrl(sessionId);
      } else {
        opened = await this.run(sessionId, ['open', options.startUrl || 'about:blank'], { flags, timeoutMs: 90000 });
      }
    } catch (error) {
      if (options.externalChrome) await this.run(sessionId, ['close'], { timeoutMs: 30000 }).catch(() => {});
      this.sessionHeaded.delete(sessionId);
      this.sessionNamespaces.delete(sessionId);
      this.externalSessions.delete(sessionId);
      throw error;
    }
    const diagnostics = await this.windowDiagnostics(sessionId).catch(() => ({
      executable: 'chromium',
      process_id: null,
      window_state: options.headed ? 'UNKNOWN' : 'HIDDEN',
      visible: Boolean(options.headed),
      safe_window_id: null,
      active_title: null
    }));
    return { ...opened, diagnostics };
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
    const result = await this.run(sessionId, ['close'], { timeoutMs: 30000 });
    this.sessionHeaded.delete(sessionId);
    this.sessionNamespaces.delete(sessionId);
    this.externalSessions.delete(sessionId);
    return result;
  }

  setSessionHeaded(sessionId, headed) {
    this.sessionHeaded.set(sessionId, headed === true);
  }

  async sessionInfo(sessionId) {
    return this.run(sessionId, ['session', 'info']);
  }

  async windowDiagnostics(sessionId) {
    const external = this.externalSessions.get(sessionId);
    if (external) {
      const state = await this.inspectExternalChrome(external, external.profilePath);
      if (!state.owned) throw new BrokerError('SESSION', 'EXTERNAL_CHROME_LOST', 'The dedicated Chrome process is no longer attached to its expected local CDP port.', undefined, 409);
      return {
        executable: path.basename(external.executablePath),
        process_id: state.portOwner,
        window_state: state.visible ? 'NORMAL' : 'UNKNOWN',
        visible: state.visible,
        safe_window_id: state.windowHandle ? `hwnd-${state.windowHandle}` : null,
        active_title: null
      };
    }
    const info = await this.sessionInfo(sessionId);
    const data = info?.output?.data || info?.output || {};
    const runtime = data.runtime && typeof data.runtime === 'object' ? data.runtime : {};
    const processId = Number(data.pid || runtime.pid) || null;
    const configuredHeaded = this.sessionHeaded.get(sessionId) ?? this.config.headed ?? process.env.AGENT_BROWSER_HEADED;
    const headed = configuredHeaded === true || configuredHeaded === '1' || configuredHeaded === 'true';
    return {
      executable: path.basename(String(runtime.executablePath || runtime.executable || 'chromium')),
      process_id: processId,
      window_state: headed ? 'UNKNOWN' : 'HIDDEN',
      visible: headed,
      safe_window_id: processId ? `pid-${processId}` : null,
      active_title: null
    };
  }

  async restoreWindow(sessionId) {
    const diagnostics = await this.windowDiagnostics(sessionId);
    if (process.platform !== 'win32' || !diagnostics.process_id) {
      throw new BrokerError('SESSION', 'WINDOW_NOT_INTERACTIVE', 'No interactive browser window is available for this session.', undefined, 409);
    }
    const script = `$root=${diagnostics.process_id};$ids=@($root);do{$before=$ids.Count;$children=Get-CimInstance Win32_Process|Where-Object{$ids -contains $_.ParentProcessId}|Select-Object -ExpandProperty ProcessId;$ids+=@($children)|Where-Object{$_ -notin $ids}}while($ids.Count -gt $before);$p=Get-Process -Id $ids -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0}|Select-Object -First 1;if(-not $p){exit 3};Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class W{[DllImport("user32.dll")]public static extern bool ShowWindowAsync(IntPtr h,int n);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);}';[W]::ShowWindowAsync($p.MainWindowHandle,9)|Out-Null;[W]::SetForegroundWindow($p.MainWindowHandle)|Out-Null;[Console]::Write($p.Id)`;
    const browserPid = Number(await runPowerShell(script));
    if (!browserPid) throw new BrokerError('SESSION', 'WINDOW_NOT_INTERACTIVE', 'No interactive browser window is available for this session.', undefined, 409);
    return {
      ...diagnostics,
      process_id: browserPid,
      window_state: 'NORMAL',
      visible: true,
      safe_window_id: `pid-${browserPid}`
    };
  }

  async run(sessionId, args, options = {}) {
    const useHeadedFlag = this.sessionHeaded.get(sessionId) && !this.externalSessions.has(sessionId);
    const globalArgs = ['--session', sessionId, '--namespace', this.sessionNamespaces.get(sessionId) || this.config.namespace, '--json', ...(useHeadedFlag ? ['--headed'] : []), ...(options.flags || [])];
    return this.#runRaw([...globalArgs, ...args], { sessionId, timeoutMs: options.timeoutMs, input: options.input });
  }

  async #verifyExternalTargets(sessionId, port) {
    const tabs = await this.run(sessionId, ['tab']);
    let expected;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('CDP target listing unavailable');
      expected = new Set((await response.json()).filter(item => item.type === 'page').map(item => item.id));
    } catch {
      throw new BrokerError('SESSION', 'CDP_TARGET_CHECK_FAILED', 'Could not verify the dedicated Chrome targets.', undefined, 502);
    }
    const actual = tabs.output?.data?.tabs?.filter(item => item.type === 'page').map(item => item.targetId) || [];
    if (!actual.length || actual.some(id => !expected.has(id))) {
      throw new BrokerError('SESSION', 'CDP_ATTACH_MISMATCH', 'agent-browser attached to a different Chrome instance.', undefined, 409);
    }
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

async function ensureExternalChrome(config, profilePath) {
  if (!existsSync(config.executablePath)) {
    throw new BrokerError('CONFIG', 'CHROME_EXECUTABLE_MISSING', 'The configured installed Chrome executable is missing.', undefined, 500);
  }
  let state = await inspectExternalChrome(config, profilePath);
  if (state.owned && state.visible) return state;
  if (state.portOwner || state.profileProcesses > 0) {
    throw new BrokerError('SESSION', 'EXTERNAL_CHROME_CONFLICT', 'The Chrome profile or CDP port is already in use by a different or non-interactive process.', undefined, 409);
  }
  await new Promise((resolve, reject) => {
    const child = spawn(config.executablePath, [
      `--user-data-dir=${profilePath}`,
      `--remote-debugging-port=${config.cdpPort}`,
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      'about:blank'
    ], { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    state = await inspectExternalChrome(config, profilePath);
    if (state.owned && state.visible) return state;
    if (state.portOwner && !state.owned) break;
  }
  throw new BrokerError('SESSION', 'EXTERNAL_CHROME_START_FAILED', 'Installed Chrome did not open an interactive window on its dedicated CDP port.', undefined, 502);
}

async function inspectExternalChrome(config, profilePath) {
  const script = `$port=[int]$env:V2_CDP_PORT;$profilePath=$env:V2_PROFILE_PATH;$chromePath=$env:V2_CHROME_PATH;$listeners=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue);$listener=@($listeners|Where-Object{$_.LocalAddress -eq '127.0.0.1'}|Select-Object -First 1);$ownerId=if($listener.Count){[int]$listener[0].OwningProcess}else{0};$owner=if($ownerId){Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId"}else{$null};$profiles=@(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'"|Where-Object{$_.CommandLine -like "*--user-data-dir=$profilePath*"});$owned=[bool]($owner -and $owner.ExecutablePath -ieq $chromePath -and $owner.CommandLine -like "*--user-data-dir=$profilePath*" -and $owner.CommandLine -like "*--remote-debugging-port=$port*");$window=if($owned){Get-Process -Id $ownerId -ErrorAction SilentlyContinue}else{$null};[pscustomobject]@{owned=$owned;portOwner=$ownerId;profileProcesses=$profiles.Count;visible=[bool]($window -and $window.MainWindowHandle -ne 0 -and $window.SessionId -ne 0);windowHandle=if($window){[string]$window.MainWindowHandle}else{$null}}|ConvertTo-Json -Compress`;
  const output = await runPowerShell(script, {
    V2_CDP_PORT: String(config.cdpPort),
    V2_PROFILE_PATH: profilePath,
    V2_CHROME_PATH: config.executablePath
  });
  return JSON.parse(output);
}

function runPowerShell(script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(stdout.trim()) : reject(new BrokerError('SESSION', 'WINDOW_NOT_INTERACTIVE', 'No interactive browser window is available for this session.', undefined, 409)));
  });
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
