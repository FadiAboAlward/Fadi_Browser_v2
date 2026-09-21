[CmdletBinding()]
param(
  [string]$Endpoint = 'http://127.0.0.1:8933/mcp'
)

$ErrorActionPreference = 'Stop'
$env:FADI_BROWSER_V1_MCP_ENDPOINT = $Endpoint
& node (Join-Path (Split-Path -Parent $PSScriptRoot) 'qa\v1-regression.mjs')
if ($LASTEXITCODE -ne 0) { throw 'V1 regression QA failed.' }
