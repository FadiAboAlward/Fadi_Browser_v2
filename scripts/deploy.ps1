[CmdletBinding()]
param(
  [string]$Commit = 'origin/main',
  [switch]$SkipFetch
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$dirty = & git -C $script:RepoRoot status --porcelain
if ($dirty) { throw 'Deployment requires a clean repository working tree.' }
if (-not $SkipFetch) {
  & git -C $script:RepoRoot fetch origin main
  if ($LASTEXITCODE -ne 0) { throw 'git fetch failed.' }
}
$resolved = (& git -C $script:RepoRoot rev-parse "$Commit^{commit}").Trim()
if (-not $resolved) { throw "Cannot resolve approved commit: $Commit" }
& git -C $script:RepoRoot merge-base --is-ancestor $resolved origin/main
if ($LASTEXITCODE -ne 0) { throw 'Refusing to deploy a commit that is not contained in fetched origin/main.' }

$target = Join-Path $script:RuntimeRoot "deployments\$resolved"
if (-not (Test-Path -LiteralPath $target)) {
  $archive = Join-Path $script:RuntimeRoot "state\deploy-$resolved.zip"
  & git -C $script:RepoRoot archive --format=zip --output=$archive $resolved
  if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  Expand-Archive -LiteralPath $archive -DestinationPath $target -Force
  Remove-Item -LiteralPath $archive -Force
  $manifest = @{ commit=$resolved; deployed_at=(Get-Date).ToUniversalTime().ToString('o'); source='origin/main' } | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $target 'deployment.json'), $manifest, [Text.UTF8Encoding]::new($false))
  Push-Location $target
  try {
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed in deployment staging.' }
    & npm test
    if ($LASTEXITCODE -ne 0) { throw 'Unit/integration tests failed in deployment staging.' }
    & npm run secret-scan
    if ($LASTEXITCODE -ne 0) { throw 'Secret scan failed in deployment staging.' }
  } finally { Pop-Location }
}

$currentPath = Join-Path $script:RuntimeRoot 'state\current-deployment.json'
$previousPath = Join-Path $script:RuntimeRoot 'state\previous-healthy.json'
$lastHealthyPath = Join-Path $script:RuntimeRoot 'state\last-healthy.json'
$previous = if (Test-Path -LiteralPath $currentPath) { Get-Content -LiteralPath $currentPath -Raw } else { $null }
if ($previous) { [IO.File]::WriteAllText($previousPath, $previous, [Text.UTF8Encoding]::new($false)) }
$next = @{ commit=$resolved; path=$target; selected_at=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json

try {
  & (Join-Path $PSScriptRoot 'stop.ps1') -ErrorAction SilentlyContinue | Out-Null
  [IO.File]::WriteAllText($currentPath, $next, [Text.UTF8Encoding]::new($false))
  & (Join-Path $PSScriptRoot 'start.ps1') | Out-Null
  $lease = Invoke-V2Request '/v1/acquire' @{ client_id='maintenance'; task_label='deploy-smoke' }
  try {
    Invoke-V2Request '/v1/navigate' @{ client_id='maintenance'; lease_token=$lease.lease_token; url='https://example.com/#deploy-smoke' } | Out-Null
    $url = Invoke-V2Request '/v1/get-url' @{ client_id='maintenance'; lease_token=$lease.lease_token }
    if (($url | ConvertTo-Json -Compress) -notmatch 'example\.com') { throw 'Post-deploy browser smoke test failed.' }
  } finally {
    if ($lease) { Invoke-V2Request '/v1/release' @{ client_id='maintenance'; lease_token=$lease.lease_token } | Out-Null }
  }
  [IO.File]::WriteAllText($lastHealthyPath, $next, [Text.UTF8Encoding]::new($false))
} catch {
  $failure = $_
  & (Join-Path $PSScriptRoot 'stop.ps1') -Force -ErrorAction SilentlyContinue | Out-Null
  if ($previous) {
    [IO.File]::WriteAllText($currentPath, $previous, [Text.UTF8Encoding]::new($false))
    & (Join-Path $PSScriptRoot 'start.ps1') | Out-Null
  } elseif (Test-Path -LiteralPath $currentPath) {
    Remove-Item -LiteralPath $currentPath -Force
    & (Join-Path $PSScriptRoot 'start.ps1') | Out-Null
  }
  throw "Deployment failed and rollback was attempted: $($failure.Exception.Message)"
}

[pscustomobject]@{
  Deployed = $true
  Commit = $resolved
  Path = $target
  Health = (Test-V2Health).broker
  RollbackAvailable = Test-Path -LiteralPath $previousPath
} | Format-List
