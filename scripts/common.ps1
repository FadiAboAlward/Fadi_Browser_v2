$ErrorActionPreference = 'Stop'

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:RuntimeRoot = if ($env:FADI_BROWSER_V2_RUNTIME_ROOT) { $env:FADI_BROWSER_V2_RUNTIME_ROOT } else { Join-Path $env:LOCALAPPDATA 'FadiBrowserV2' }
$script:ConfigPath = Join-Path $script:RuntimeRoot 'config\config.json'
$script:Entropy = [Text.Encoding]::UTF8.GetBytes('Fadi Browser V2')

function Get-V2Config {
  if (-not (Test-Path -LiteralPath $script:ConfigPath)) { throw "V2 is not installed: $script:ConfigPath is missing." }
  return Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
}

function Unprotect-V2Secret([string]$Name) {
  $path = Join-Path $script:RuntimeRoot "config\$Name.dpapi"
  if (-not (Test-Path -LiteralPath $path)) { throw "Protected local secret is missing: $Name" }
  $protected = [Convert]::FromBase64String((Get-Content -LiteralPath $path -Raw).Trim())
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($protected, $script:Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  return [Text.Encoding]::UTF8.GetString($plain)
}

function Import-V2Secrets {
  $env:FADI_BROWSER_V2_API_TOKEN = Unprotect-V2Secret 'broker-token'
  $env:AGENT_BROWSER_ENCRYPTION_KEY = Unprotect-V2Secret 'agent-browser-key'
  $env:FADI_BROWSER_V2_RUNTIME_ROOT = $script:RuntimeRoot
  $env:FADI_BROWSER_V2_CONFIG = $script:ConfigPath
}

function Get-V2SourceRoot {
  $currentPath = Join-Path $script:RuntimeRoot 'state\current-deployment.json'
  if (Test-Path -LiteralPath $currentPath) {
    $current = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json
    $candidate = [IO.Path]::GetFullPath([string]$current.path)
    $deployments = [IO.Path]::GetFullPath((Join-Path $script:RuntimeRoot 'deployments'))
    if ($candidate.StartsWith($deployments, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath (Join-Path $candidate 'src\server.mjs'))) {
      return $candidate
    }
  }
  return $script:RepoRoot
}

function Get-V2Port {
  $config = Get-V2Config
  return [int]$config.port
}

function Invoke-V2Request([string]$Path, [hashtable]$Body = @{}) {
  Import-V2Secrets
  $port = Get-V2Port
  $headers = @{ Authorization = "Bearer $env:FADI_BROWSER_V2_API_TOKEN" }
  return Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port$Path" -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20 -Compress) -TimeoutSec 120
}

function Test-V2Health {
  try {
    $port = Get-V2Port
    return Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5
  } catch { return $null }
}
