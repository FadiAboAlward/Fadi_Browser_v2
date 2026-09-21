[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Import-V2Secrets
$sourceRoot = Get-V2SourceRoot
& node (Join-Path $sourceRoot 'qa\mcp-smoke.mjs')
exit $LASTEXITCODE
