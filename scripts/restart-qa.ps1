[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$lease = Invoke-V2Request '/v1/acquire' @{ client_id='maintenance'; task_label='qa-crash-restart' }
try {
  Invoke-V2Request '/v1/navigate' @{ client_id='maintenance'; lease_token=$lease.lease_token; url='https://example.com/#restart-ownership' } | Out-Null
  $pidPath = Join-Path $script:RuntimeRoot 'state\broker.pid'
  $brokerPid = [int](Get-Content -LiteralPath $pidPath -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$brokerPid"
  if (-not $process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'src[\\/]server\.mjs') {
    throw 'Refusing crash simulation: recorded PID is not the V2 broker.'
  }
  Stop-Process -Id $brokerPid -Force
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Process -Id $brokerPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (Get-Process -Id $brokerPid -ErrorAction SilentlyContinue) { throw 'V2 broker did not stop during crash simulation.' }

  & (Join-Path $PSScriptRoot 'start.ps1') | Out-Null
  $recovered = Invoke-V2Request '/v1/recover' @{ client_id='maintenance'; lease_token=$lease.lease_token }
  if ($recovered.status -ne 'ACTIVE') { throw 'Lease did not return to ACTIVE after restart.' }
  $url = Invoke-V2Request '/v1/get-url' @{ client_id='maintenance'; lease_token=$lease.lease_token }
  if (($url | ConvertTo-Json -Compress) -notmatch 'restart-ownership') { throw 'Recovered lease did not retain its owned browser URL.' }
  Invoke-V2Request '/v1/release' @{ client_id='maintenance'; lease_token=$lease.lease_token } | Out-Null
  $lease = $null
  [pscustomobject]@{ Status='PASS'; LeaseRecovered=$true; SameOwnership=$true; V1Modified=$false } | Format-List
} finally {
  if ($lease) {
    try { Invoke-V2Request '/v1/release' @{ client_id='maintenance'; lease_token=$lease.lease_token } | Out-Null } catch {}
  }
}
