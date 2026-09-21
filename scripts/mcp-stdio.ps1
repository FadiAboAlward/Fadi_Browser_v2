[CmdletBinding()]
param(
  [string]$ClientId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Import-V2Secrets
if ($ClientId) {
  $env:FADI_BROWSER_V2_CLIENT_ID = $ClientId
}
# Write-Host "DEBUG: ClientId=$ClientId"
$sourceRoot = Get-V2SourceRoot
& node (Join-Path $sourceRoot 'src\mcp-stdio.mjs')
exit $LASTEXITCODE
