// Check one slot's Sentry login through V2, then release and reacquire it.
const target = process.argv[2];
if (!['browser-3', 'browser-4', 'browser-5'].includes(target)) throw new Error('Expected browser-3, browser-4, or browser-5.');
const single = process.argv.includes('--single');
const token = process.env.FADI_BROWSER_V2_API_TOKEN;
if (!token) throw new Error('FADI_BROWSER_V2_API_TOKEN is required.');
const held = [];

async function post(route, body) {
  const response = await fetch(`http://127.0.0.1:8951${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fadi-browser-token': token },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error?.code || response.status}: ${data.error?.message || 'request failed'}`);
  return data;
}

async function acquireThroughTarget() {
  for (let i = 0; i < Number(target.at(-1)); i += 1) {
    const clientId = i < 3 ? 'goilot-gpt' : 'goilot-claude';
    held.push(await post('/v1/acquire', { client_id: clientId, pool_id: 'default', wait_timeout_ms: 0 }));
  }
  const lease = held.at(-1);
  if (lease.browser_slot_id !== target) throw new Error(`Expected ${target}, got ${lease.browser_slot_id}.`);
  return lease;
}

async function releaseAll() {
  while (held.length) {
    const lease = held.pop();
    await post('/v1/release', { client_id: lease.client_id, lease_token: lease.lease_token });
  }
}

async function authState(lease) {
  await post('/v1/navigate', { client_id: lease.client_id, lease_token: lease.lease_token, url: 'https://alex-roup.sentry.io/issues/' });
  const result = await post('/v1/get-url', { client_id: lease.client_id, lease_token: lease.lease_token });
  const current = new URL(result.output?.data?.url);
  return { authenticated: current.hostname === 'alex-roup.sentry.io' && current.pathname.startsWith('/issues'), origin: current.origin, path: current.pathname };
}

try {
  const initial = await (await fetch('http://127.0.0.1:8951/health')).json();
  if (initial.sessions_active || initial.sessions_queued) throw new Error('Refusing auth check while another lease or queue entry exists.');
  const first = await acquireThroughTarget();
  const firstState = await authState(first);
  const firstStatus = await post('/v1/status', { client_id: first.client_id, lease_token: first.lease_token });
  console.log(JSON.stringify({ slot: target, first_origin: firstState.origin, first_path: firstState.path, visible: firstStatus.browser?.visible, process_id: firstStatus.browser?.process_id }));
  await releaseAll();
  if (!firstState.authenticated) throw new Error(`${target} is not authenticated in Sentry.`);
  if (!firstStatus.browser?.visible) throw new Error(`${target} is not visible.`);
  if (single) {
    console.log(JSON.stringify({ slot: target, authenticated: true, visible: true, process_id: firstStatus.browser.process_id, check: 'single_acquire' }));
  } else {
    const second = await acquireThroughTarget();
    const secondState = await authState(second);
    const secondStatus = await post('/v1/status', { client_id: second.client_id, lease_token: second.lease_token });
    if (!secondState.authenticated) throw new Error(`${target} did not retain Sentry authentication after reacquire.`);
    if (!secondStatus.browser?.visible || firstStatus.browser.process_id !== secondStatus.browser.process_id) {
      throw new Error(`${target} did not preserve its visible Chrome process across release/reacquire.`);
    }
    console.log(JSON.stringify({ slot: target, authenticated: true, release_reacquire: true, visible: true, process_id: secondStatus.browser.process_id, origin: secondState.origin, path: secondState.path }));
  }
} finally {
  await releaseAll().catch(error => console.error(`cleanup failed: ${error.message}`));
  const final = await (await fetch('http://127.0.0.1:8951/health')).json();
  console.log(`cleanup: active=${final.sessions_active}, queued=${final.sessions_queued}`);
}
