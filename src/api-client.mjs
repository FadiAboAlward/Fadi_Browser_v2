import { BrokerError } from './errors.mjs';

export class BrokerApiClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  acquire(input) { return this.#post('/v1/acquire', mapInput(input)); }
  status(input = {}) { return this.#post('/v1/status', mapInput(input)); }
  recover(input) { return this.#post('/v1/recover', mapInput(input)); }
  release(input) { return this.#post('/v1/release', mapInput(input)); }
  navigate(input) { return this.#post('/v1/navigate', mapInput(input)); }
  snapshot(input) { return this.#post('/v1/snapshot', mapInput(input)); }
  getUrl(input) { return this.#post('/v1/get-url', mapInput(input)); }
  getTitle(input) { return this.#post('/v1/get-title', mapInput(input)); }
  evaluate(input) { return this.#post('/v1/evaluate', mapInput(input)); }
  command(input) { return this.#post('/v1/command', mapInput(input)); }
  restoreWindow(input) { return this.#post('/v1/restore-window', mapInput(input)); }
  screenshot(input) { return this.#post('/v1/screenshot', mapInput(input)); }
  consoleMessages(input) { return this.#post('/v1/console-messages', mapInput(input)); }
  pageErrors(input) { return this.#post('/v1/page-errors', mapInput(input)); }
  networkRequests(input) { return this.#post('/v1/network-requests', mapInput(input)); }
  networkRequestDetail(input) { return this.#post('/v1/network-request-details', mapInput(input)); }
  waitForCondition(input) { return this.#post('/v1/wait-for-condition', mapInput(input)); }
  resize(input) { return this.#post('/v1/resize', mapInput(input)); }
  cancelQueue(input) { return this.#post('/v1/queue/cancel', mapInput(input)); }

  async #post(route, payload) {
    const response = await fetch(`${this.baseUrl}${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new BrokerError(body?.error?.category || 'MCP_TRANSPORT', body?.error?.code || 'HTTP_ERROR', body?.error?.message || `Broker HTTP ${response.status}`, body?.error?.details, response.status);
    }
    return body;
  }
}

function mapInput(input) {
  const mapped = { ...input };
  const pairs = [
    ['clientId', 'client_id'],
    ['leaseToken', 'lease_token'],
    ['authProfileId', 'auth_profile_id'],
    ['taskLabel', 'task_label'],
    ['waitTimeoutMs', 'wait_timeout_ms'],
    ['queueId', 'queue_id'],
    ['fullPage', 'full_page'],
    ['requestId', 'request_id'],
    ['textGone', 'text_gone'],
    ['loadState', 'load_state'],
    ['timeoutMs', 'timeout_ms']
  ];
  for (const [camel, snake] of pairs) {
    if (camel in mapped) {
      mapped[snake] = mapped[camel];
      delete mapped[camel];
    }
  }
  return mapped;
}
