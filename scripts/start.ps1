[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$health = Test-V2Health
if ($health) { $health; return }

Import-V2Secrets
$sourceRoot = Get-V2SourceRoot
$node = (Get-Command node -ErrorAction Stop).Source
$commit = $null
$sourceDirty = $false
$deploymentManifest = Join-Path $sourceRoot 'deployment.json'
if (Test-Path -LiteralPath $deploymentManifest) {
  $commit = (Get-Content -LiteralPath $deploymentManifest -Raw | ConvertFrom-Json).commit
} elseif (Test-Path -LiteralPath (Join-Path $sourceRoot '.git')) {
  $headCommit = (& git -C $sourceRoot rev-parse HEAD).Trim()
  $workingTreeStatus = @(& git -C $sourceRoot status --porcelain)
  $sourceDirty = $workingTreeStatus.Count -gt 0
  $commit = if ($sourceDirty) { "working-tree@$headCommit" } else { $headCommit }
}
if (-not $commit) {
  $commit = 'working-tree'
  $sourceDirty = $true
}
$env:FADI_BROWSER_V2_RUNNING_COMMIT = $commit
$env:FADI_BROWSER_V2_SOURCE_DIRTY = if ($sourceDirty) { 'true' } else { 'false' }

$stdout = Join-Path $script:RuntimeRoot 'logs\broker.out.log'
$stderr = Join-Path $script:RuntimeRoot 'logs\broker.err.log'
$process = Start-Process -FilePath $node -ArgumentList @('src/server.mjs') -WorkingDirectory $sourceRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Milliseconds 500
  if ($process.HasExited) { throw "V2 broker exited during startup. See $stderr" }
  $health = Test-V2Health
} until ($health -or (Get-Date) -gt $deadline)
if (-not $health) { throw 'V2 broker did not become healthy within 45 seconds.' }
$health
