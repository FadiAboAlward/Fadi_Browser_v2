[CmdletBinding()]
param([switch]$NoStart)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$nodeVersion = (& node --version).TrimStart('v').Split('.')[0]
if ([int]$nodeVersion -lt 24) { throw 'Node.js 24 or newer is required.' }

Push-Location $script:RepoRoot
try { & npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' } }
finally { Pop-Location }

$directories = @('config','data','logs','state','auth','diagnostics','qa','deployments')
foreach ($name in $directories) { New-Item -ItemType Directory -Path (Join-Path $script:RuntimeRoot $name) -Force | Out-Null }

if (-not (Test-Path -LiteralPath $script:ConfigPath)) {
  Copy-Item -LiteralPath (Join-Path $script:RepoRoot 'config\config.example.json') -Destination $script:ConfigPath
}

function New-ProtectedSecret([string]$Name, [int]$Bytes) {
  $path = Join-Path $script:RuntimeRoot "config\$Name.dpapi"
  if (Test-Path -LiteralPath $path) { return }
  $buffer = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  $value = [Convert]::ToHexString($buffer).ToLowerInvariant()
  $plain = [Text.Encoding]::UTF8.GetBytes($value)
  $protected = [Security.Cryptography.ProtectedData]::Protect($plain, $script:Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllText($path, [Convert]::ToBase64String($protected), [Text.UTF8Encoding]::new($false))
}

New-ProtectedSecret 'broker-token' 32
New-ProtectedSecret 'agent-browser-key' 32

$taskName = 'Fadi Browser V2'
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$startScript = Join-Path $script:RepoRoot 'scripts\start.ps1'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Starts Fadi Browser V2 independently from Fadi Playwright V1.' -Force | Out-Null

& (Join-Path $PSScriptRoot 'inventory-v1.ps1') | Out-Null

if (-not $NoStart) { & (Join-Path $PSScriptRoot 'start.ps1') }

[pscustomobject]@{
  Installed = $true
  RuntimeRoot = $script:RuntimeRoot
  StartupTask = $taskName
  ConfiguredPort = Get-V2Port
  AuthSecrets = 'DPAPI CurrentUser protected'
  V1Modified = $false
} | Format-List
