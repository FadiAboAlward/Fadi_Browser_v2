# Client Integration Architecture

Fadi Browser V2 uses a strict server-side pre-binding model to securely associate AI clients with their designated persistent browser sessions (auth profiles) without passing sensitive credentials over the MCP protocol.

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
- **Status**: ✅ **Registered & Active**.

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

### 1. Server-Side Pre-Binding (Security)

V2 strictly prevents impersonation. An AI client cannot simply pass `{"client_id": "fadi-gpt"}` in its MCP tool arguments to steal a session.

Instead, the client ID is **pre-bound server-side** at the transport layer:
- **For Stdio (Local MCP)**: The `mcp-stdio.ps1` script takes a `-ClientId <id>` argument which exports `$env:FADI_BROWSER_V2_CLIENT_ID`. The V2 `mcp-stdio.mjs` wrapper reads this and strictly binds all incoming operations to that ID.
- **For HTTP (Cloudflare Tunnels / Remote MCP)**: The V2 HTTP server (`server.mjs`) allows path-based pre-binding. Tunnels configured for a specific client should point to `http://127.0.0.1:8951/mcp/<client_id>`. The broker extracts the `<client_id>` from the URL path and securely binds the MCP session.

If the incoming MCP tool invocation provides a `client_id` that does not match the pre-bound transport ID, the request is actively rejected with an `Impersonation blocked` error.

### 2. Adding or Rotating Clients

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
