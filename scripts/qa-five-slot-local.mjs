// Live, local-only capacity check. Requires the broker token in the environment.
const token = process.env.FADI_BROWSER_V2_API_TOKEN;
if (!token) throw new Error('FADI_BROWSER_V2_API_TOKEN is required.');

const base = 'http://127.0.0.1:8951';
const held = [];
let sixth = null;

async function post(route, body) {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fadi-browser-token': token },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || `HTTP ${response.status}`);
    error.code = data.error?.code || data.code;
    throw error;
  }
  return data;
}

async function health() {
  const response = await fetch(`${base}/health`);
  if (!response.ok) throw new Error(`Health HTTP ${response.status}`);
  return response.json();
}

try {
  const initial = await health();
  if (initial.sessions_active || initial.sessions_queued) throw new Error('Refusing capacity check while another lease or queue entry exists.');
  if (initial.browser_pools?.default?.slots?.length !== 5) throw new Error('Expected exactly five configured slots.');

  for (const clientId of ['goilot-gpt', 'goilot-claude', 'goilot-gpt', 'goilot-claude', 'goilot-gpt']) {
    const lease = await post('/v1/acquire', { client_id: clientId, pool_id: 'default', wait_timeout_ms: 0 });
    held.push(lease);
    const status = await post('/v1/status', { client_id: clientId, lease_token: lease.lease_token });
    if (status.status !== 'ACTIVE' || status.browser?.visible !== true) {
      throw new Error(`${lease.browser_slot_id} is not ACTIVE and visible.`);
    }
    console.log(`${lease.browser_slot_id}: ACTIVE, visible, profile=${lease.auth_profile_id}`);
  }

  const filled = await health();
  if (filled.sessions_active !== 5 || filled.browser_pools.default.slots.some(slot => slot.state !== 'BUSY')) {
    throw new Error('Five-slot occupancy was not reached.');
  }

  try {
    await post('/v1/acquire', { client_id: 'fadi-gpt', pool_id: 'default', wait_timeout_ms: 0 });
    throw new Error('Sixth immediate request unexpectedly acquired a slot.');
  } catch (error) {
    if (error.code !== 'POOL_EXHAUSTED') throw error;
    console.log('sixth immediate request: POOL_EXHAUSTED');
  }

  const queued = post('/v1/acquire', { client_id: 'fadi-gpt', pool_id: 'default', wait_timeout_ms: 30000 });
  await new Promise(resolve => setTimeout(resolve, 1000));
  const waiting = await health();
  if (waiting.sessions_queued !== 1 || waiting.sessions_active !== 5) throw new Error('Sixth request did not join the queue.');
  console.log('sixth waiting request: QUEUED');

  const freed = held.shift();
  await post('/v1/release', { client_id: freed.client_id, lease_token: freed.lease_token });
  sixth = await queued;
  if (sixth.browser_slot_id !== freed.browser_slot_id) throw new Error('Queued request did not claim the released slot.');
  console.log(`sixth waiting request: PROMOTED to ${sixth.browser_slot_id}`);
} finally {
  for (const lease of held) {
    await post('/v1/release', { client_id: lease.client_id, lease_token: lease.lease_token }).catch(error => console.error(`release failed: ${error.code || error.message}`));
  }
  if (sixth) await post('/v1/release', { client_id: sixth.client_id, lease_token: sixth.lease_token }).catch(error => console.error(`sixth release failed: ${error.code || error.message}`));
  const final = await health();
  console.log(`final: active=${final.sessions_active}, queued=${final.sessions_queued}, slots=${final.browser_pools.default.slots.map(slot => slot.state).join(',')}`);
}
