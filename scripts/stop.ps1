[CmdletBinding()]
param([switch]$PreserveForRestart, [switch]$Force)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$pidPath = Join-Path $script:RuntimeRoot 'state\broker.pid'
$pidValue = if (Test-Path -LiteralPath $pidPath) { [int](Get-Content -LiteralPath $pidPath -Raw) } else { 0 }
if (Test-V2Health) {
  $mode = if ($PreserveForRestart) { 'restart' } else { 'graceful' }
  Invoke-V2Request '/v1/admin/shutdown' @{ mode = $mode } | Out-Null
}

$deadline = (Get-Date).AddSeconds(30)
while ($pidValue -gt 0 -and (Get-Process -Id $pidValue -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
$remaining = if ($pidValue -gt 0) { Get-Process -Id $pidValue -ErrorAction SilentlyContinue } else { $null }
if ($remaining -and $Force) {
  $command = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
  if ($command.CommandLine -notmatch 'src[\\/]server\.mjs') { throw 'Refusing to force-stop a process that is not the V2 server.' }
  Stop-Process -Id $pidValue -Force
  $remaining = $null
}
if ($remaining) { throw 'V2 did not stop cleanly. Re-run with -Force only if a V2-only forced stop is intended.' }
[pscustomobject]@{ Stopped = $true; PreservedForRestart = [bool]$PreserveForRestart; V1Modified = $false }
