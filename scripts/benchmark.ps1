[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Import-V2Secrets
$sourceRoot = Get-V2SourceRoot
Push-Location $sourceRoot
try { & node 'benchmarks\run-baseline.mjs'; exit $LASTEXITCODE }
finally { Pop-Location }
