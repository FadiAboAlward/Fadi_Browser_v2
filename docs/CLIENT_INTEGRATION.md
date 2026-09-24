# Client Integration Architecture

Fadi Browser V2 uses strict server-side pre-binding for AI client identity. An optional shared browser pool lets an authorized client lease a free persistent browser slot without changing that identity or passing sensitive credentials over MCP.

## Registered Clients

There are currently three user-facing AI clients configured in V2:

| Client Display Name | Internal Client ID | Mapped Auth Profile | Profile Mode |
|---------------------|--------------------|---------------------|--------------|
| Fadi GPT            | `fadi-gpt`         | `fadi`              | Persistent (`profile_bound`) |
| Goilot GPT          | `goilot-gpt`       | `goilot`            | Persistent (`profile_bound`) |
| Goilot Claude       | `goilot-claude`    | `goilot-claude`     | Persistent (`profile_bound`) |

### Real Environment Registration Status

**Goilot Claude**:
- **Environment**: Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`)
- **Transport**: Stdio
- **Entrypoint**: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\Fadi\OneDrive\Documents\GitHub\Fadi_Browser_v2\scripts\mcp-stdio.ps1 -ClientId goilot-claude`
- **Status**: Registered. The independently pre-bound `goilot-claude` MCP path and stdio implementation passed local invocation; Claude Desktop UI invocation was not part of the two-slot trial.

**Fadi GPT**:
- **Environment**: ChatGPT (OpenAI Platform)
- **Transport**: Remote SSE (Cloudflare Tunnels via `tunnel-client.exe`)
- **Endpoint**: `http://127.0.0.1:8951/mcp/fadi-gpt`
- **Status**: See the Fadi GPT task; Goilot activation does not change this client.

**Goilot GPT**:
- **Environment**: ChatGPT in the `Alex_Workspace` Business workspace, using the separate V1 Account B browser for setup and QA.
- **Transport**: OpenAI secure MCP tunnel via the existing Goilot-only `tunnel-client.exe` profile.
- **Endpoint**: `http://127.0.0.1:8951/mcp/goilot-gpt`
- **App authentication**: ChatGPT app uses `No Auth`; the local tunnel supplies the broker credential through encrypted local configuration. The credential is never entered into ChatGPT or included in Git.
- **Task binding**: ChatGPT issues a fresh MCP transport session for each tool call. For this endpoint only, the broker hashes the ingress-provided `x-openai-subject` and `x-openai-session` headers to select a per-chat server-side lease context. Both headers must be present; otherwise behavior fails closed to transport-session binding. Different chats never share a context. Normal browser calls still take no lease credential.
- **Lifecycle**: `browser_release` clears the bound context; idle contexts are discarded after the lease and recovery windows. A broker restart still requires explicit recovery with the original credential and does not silently rebind.
- **Visible browser**: `authProfiles.goilot.headed` is `true`. For the one-browser persistence proof, optional `authProfiles.goilot.externalChrome` names an installed Chrome executable and a dedicated loopback CDP port. V2 starts or attaches to the same `%LOCALAPPDATA%\FadiBrowserV2\auth\goilot` profile; agent-browser attaches to the current tab. Releasing the AI lease detaches agent-browser and leaves this externally owned Chrome window open. If Chrome was manually closed, the next acquire starts it with the same profile. No human-takeover or pause/resume protocol is involved. Sentry and Google login persistence must be verified separately.

### 1. Server-Side Pre-Binding (Security)

V2 strictly prevents impersonation. An AI client cannot simply pass `{"client_id": "fadi-gpt"}` in its MCP tool arguments to steal a session.

Instead, the client ID is **pre-bound server-side** at the transport layer:
- **For Stdio (Local MCP)**: The `mcp-stdio.ps1` script takes a `-ClientId <id>` argument which exports `$env:FADI_BROWSER_V2_CLIENT_ID`. The V2 `mcp-stdio.mjs` wrapper reads this and strictly binds all incoming operations to that ID.
- **For HTTP (Cloudflare Tunnels / Remote MCP)**: The V2 HTTP server (`server.mjs`) allows path-based pre-binding. Tunnels configured for a specific client should point to `http://127.0.0.1:8951/mcp/<client_id>`. The broker extracts the `<client_id>` from the URL path and securely binds the MCP session.

If the incoming MCP tool invocation provides a `client_id` that does not match the pre-bound transport ID, the request is actively rejected with an `Impersonation blocked` error.

### 2. Shared pool routing and legacy migration

Set `browserPools.default.slots` in the private V2 config to ordered `{ "id": "browser-1", "authProfileId": "goilot" }`-style mappings. Every mapped auth profile must be persistent, `profile_bound`, headed, and configured for a separate installed Chrome user-data directory and loopback CDP port. Grant each participating client `allowedPools: ["default"]`; set `defaultPool: "default"` only for clients whose no-argument acquire should enter the pool. Keep its original `defaultAuthProfile` and `allowedAuthProfiles` for explicit legacy requests. Pool access alone does not authorize `auth_profile_id` for another identity.

For a client with `defaultPool`, `browser_acquire()` selects the first free slot in that pool; `browser_acquire(pool_id="default")` selects it explicitly for any client allowed there. A client without `defaultPool` retains its legacy no-argument default. The response includes `browser_slot_id` and `pool_id`. A client cannot choose a slot ID. `browser_acquire(auth_profile_id="goilot")` remains an explicit legacy request and uses the original allowlist. `pool_id` and `auth_profile_id` cannot be supplied together. Profile-bound exclusivity also applies across pooled and explicit legacy calls. If both slots are busy, use the existing bounded FIFO wait; release leaves the installed Chrome and its auth state intact.

The first two-slot trial keeps `goilot` as the backing identity for `browser-1` and gives `browser-2` its own fresh profile. A login in one slot is not automatically present in the other. No V1 profile, connector credential, or tunnel is reused for a browser slot.

On 24 Sep 2026, the local two-slot trial used Alex ChatGPT → Goilot GPT for Client A and an independent pre-bound `goilot-claude` MCP client for Client B. Both held active leases simultaneously on separate installed Chrome processes/profile directories; release of A left B active, and releasing B returned both slots to FREE with 0 active and 0 queued. A follow-up acquire reattached to the same persistent Chrome processes. The fresh `browser-2` profile showed Sentry's login state; this is expected until that slot is authenticated separately. This test does not claim Claude Desktop UI invocation or a five-slot rollout.

### 3. Adding or Rotating Clients

To add a new client or rotate configurations:
1. Update `config/config.json` under `clients` to add the new `client_id` and map its `defaultAuthProfile` and `allowedAuthProfiles`.
2. Add the corresponding `authProfile` definition (e.g. `persistent: true, mode: "profile_bound"`).
3. Restart the V2 Broker service.
4. Update this documentation to reflect the new client architecture.
5. Create a new tunnel or stdio configuration (e.g., updating `claude_desktop_config.json` or `family-playwright.yaml`) to point to the correct pre-bound endpoint (`/mcp/<client_id>` or `-ClientId <id>`).

> **Important**: Never commit or document secrets, tunnel IDs, or API keys in this repository.

## Troubleshooting

- **Impersonation Blocked**: Ensure the transport layer (tunnel path or stdio env variable) matches the `client_id` the AI is passing.
- **Queue Timeout**: Ensure previous crashed sessions were correctly reaped. The broker will enforce `maxSessionsPerClient` (default: 3). If `profile_bound` is used, only 1 session per auth profile is allowed concurrently.
- **fetch failed**: If you see `fetch failed` or `ECONNREFUSED` locally, ensure the V2 Broker daemon is running on port 8951.
