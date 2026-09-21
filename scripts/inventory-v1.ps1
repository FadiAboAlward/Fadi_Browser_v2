[CmdletBinding()]
param()
$ErrorActionPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'common.ps1')

function Test-LocalPort([int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try { return $client.ConnectAsync('127.0.0.1', $Port).Wait(1200) -and $client.Connected }
  catch { return $false }
  finally { $client.Dispose() }
}

function Sanitize-Command([string]$Value) {
  if (-not $Value) { return $Value }
  $clean = $Value -replace '(?i)(--(?:token|secret|password|api-key|key|auth|credential)(?:=|\s+))("[^"]*"|\S+)', '$1[REDACTED]'
  return $clean -replace '(?i)(https?://[^\s?]+)\?\S+', '$1?[REDACTED]'
}

$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(node|msedge|chrome|tunnel-client)\.exe$' -and $_.CommandLine -match '(?i)FamilyLearningHub|PlaywrightAccount2Chrome|gateway|tunnel-client'
} | ForEach-Object {
  [pscustomobject]@{ pid=$_.ProcessId; name=$_.Name; executable=$_.ExecutablePath; command=(Sanitize-Command $_.CommandLine) }
}

$tasks = Get-ScheduledTask | Where-Object { $_.TaskName -match '^Fadi Playwright' } | ForEach-Object {
  [pscustomobject]@{
    name=$_.TaskName
    path=$_.TaskPath
    state=[string]$_.State
    actions=@($_.Actions | ForEach-Object { Sanitize-Command (($_.Execute + ' ' + $_.Arguments).Trim()) })
  }
}

$runNames = @()
$runKey = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ($runKey) { $runNames = @($runKey.PSObject.Properties.Name | Where-Object { $_ -notmatch '^PS' -and $_ -match '(?i)Fadi|Playwright' }) }

$inventory = [ordered]@{
  generated_at=(Get-Date).ToUniversalTime().ToString('o')
  mode='read-only-sanitized'
  v1_modified=$false
  processes=$processes
  scheduled_tasks=$tasks
  startup_registry_value_names=$runNames
  ports=[ordered]@{
    edge_worker_8931=(Test-LocalPort 8931)
    edge_tunnel_health_8932=(Test-LocalPort 8932)
    broker_ingress_a_8933=(Test-LocalPort 8933)
    chrome_worker_8941=(Test-LocalPort 8941)
    chrome_tunnel_health_8942=(Test-LocalPort 8942)
    broker_ingress_b_8943=(Test-LocalPort 8943)
  }
  mcp_endpoints=@('http://127.0.0.1:8931','http://127.0.0.1:8941')
  broker_endpoints=@('http://127.0.0.1:8933','http://127.0.0.1:8943')
  runtime_paths=@(
    "$env:LOCALAPPDATA\FamilyLearningHub\PlaywrightBroker",
    "$env:LOCALAPPDATA\PlaywrightAccount2Chrome"
  )
  browser_profiles=@(
    "$env:LOCALAPPDATA\FamilyLearningHub\PlaywrightProfile",
    "$env:LOCALAPPDATA\PlaywrightAccount2Chrome\Account2IsolatedProfile"
  )
  tunnel_processes=@($processes | Where-Object { $_.name -eq 'tunnel-client.exe' } | Select-Object pid,executable)
}

New-Item -ItemType Directory -Path (Join-Path $script:RuntimeRoot 'diagnostics') -Force | Out-Null
$path = Join-Path $script:RuntimeRoot ("diagnostics\v1-inventory-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
[IO.File]::WriteAllText($path, ($inventory | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
[pscustomobject]@{ Created=$true; Path=$path; Sanitized=$true; V1Modified=$false } | Format-List
