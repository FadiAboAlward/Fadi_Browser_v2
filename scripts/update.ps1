[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
& git -C $script:RepoRoot fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'git fetch failed.' }
$source = (& git -C $script:RepoRoot rev-parse origin/main).Trim()
$runningPath = Join-Path $script:RuntimeRoot 'state\running-version.json'
$running = if (Test-Path -LiteralPath $runningPath) { (Get-Content -LiteralPath $runningPath -Raw | ConvertFrom-Json).running_commit } else { 'none' }
Write-Output "GitHub approved main: $source"
Write-Output "Local running commit: $running"
& (Join-Path $PSScriptRoot 'deploy.ps1') -Commit $source -SkipFetch
