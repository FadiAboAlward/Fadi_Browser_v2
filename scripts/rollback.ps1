[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$currentPath = Join-Path $script:RuntimeRoot 'state\current-deployment.json'
$previousPath = Join-Path $script:RuntimeRoot 'state\previous-healthy.json'
if (-not (Test-Path -LiteralPath $previousPath)) { throw 'No previous healthy deployment is recorded.' }
$previous = Get-Content -LiteralPath $previousPath -Raw
$parsed = $previous | ConvertFrom-Json
$resolvedPath = [IO.Path]::GetFullPath([string]$parsed.path)
$deployments = [IO.Path]::GetFullPath((Join-Path $script:RuntimeRoot 'deployments'))
if (-not $resolvedPath.StartsWith($deployments, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath (Join-Path $resolvedPath 'src\server.mjs'))) {
  throw 'Previous deployment reference is invalid or outside the V2 runtime.'
}
$current = if (Test-Path -LiteralPath $currentPath) { Get-Content -LiteralPath $currentPath -Raw } else { $null }
& (Join-Path $PSScriptRoot 'stop.ps1') -ErrorAction SilentlyContinue | Out-Null
[IO.File]::WriteAllText($currentPath, $previous, [Text.UTF8Encoding]::new($false))
if ($current) { [IO.File]::WriteAllText($previousPath, $current, [Text.UTF8Encoding]::new($false)) }
& (Join-Path $PSScriptRoot 'start.ps1') | Out-Null
$health = Test-V2Health
if (-not $health -or $health.broker -ne 'HEALTHY') { throw 'Rollback target did not become healthy.' }
[pscustomobject]@{ RolledBack=$true; Commit=$parsed.commit; Health=$health.broker; V1Modified=$false } | Format-List
