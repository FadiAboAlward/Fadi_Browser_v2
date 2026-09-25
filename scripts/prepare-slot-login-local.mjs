// Navigate one independent persistent slot to Sentry for one-time manual login.
const target = process.argv[2];
if (!['browser-3', 'browser-4', 'browser-5'].includes(target)) throw new Error('Expected browser-3, browser-4, or browser-5.');
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

try {
  const health = await (await fetch('http://127.0.0.1:8951/health')).json();
  if (health.sessions_active || health.sessions_queued) throw new Error('Refusing setup while another lease or queue entry exists.');
  const count = Number(target.at(-1));
  for (let i = 0; i < count; i += 1) {
    const clientId = i < 3 ? 'goilot-gpt' : 'goilot-claude';
    held.push(await post('/v1/acquire', { client_id: clientId, pool_id: 'default', wait_timeout_ms: 0 }));
  }
  const lease = held.at(-1);
  if (lease.browser_slot_id !== target) throw new Error(`Expected ${target}, got ${lease.browser_slot_id}.`);
  await post('/v1/navigate', { client_id: lease.client_id, lease_token: lease.lease_token, url: 'https://alex-roup.sentry.io/issues/' });
  const url = await post('/v1/get-url', { client_id: lease.client_id, lease_token: lease.lease_token });
  const window = await post('/v1/restore-window', { client_id: lease.client_id, lease_token: lease.lease_token });
  console.log(JSON.stringify({ slot: target, profile: lease.auth_profile_id, url: url.output?.data?.url || null, visible: window.visible, process_id: window.process_id }));
} finally {
  // Release in acquisition order so the prepared target is detached last.
  for (const lease of held) {
    await post('/v1/release', { client_id: lease.client_id, lease_token: lease.lease_token }).catch(error => console.error(`release failed: ${error.message}`));
  }
  const health = await (await fetch('http://127.0.0.1:8951/health')).json();
  console.log(`cleanup: active=${health.sessions_active}, queued=${health.sessions_queued}`);
}
