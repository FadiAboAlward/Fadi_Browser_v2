[CmdletBinding()]
param([ValidateSet(1,7,14,30)][int]$Days = 7)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$sourceRoot = Get-V2SourceRoot
& node (Join-Path $sourceRoot 'src\report.mjs') --days $Days
exit $LASTEXITCODE
