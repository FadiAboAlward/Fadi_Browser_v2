[CmdletBinding()]
param(
  [string]$ClientId
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Import-V2Secrets
if ($ClientId -eq 'goilot-claude') {
  $aliasPath = Join-Path $env:USERPROFILE '.codex\private\FadiBrowserV2\broker-token.dpapi'
  if (-not (Test-Path -LiteralPath $aliasPath)) { throw 'Claude V2 broker credential alias is missing.' }
  $protected = [Convert]::FromBase64String([IO.File]::ReadAllText($aliasPath).Trim())
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($protected, $script:Entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $env:FADI_BROWSER_V2_API_TOKEN = [Text.Encoding]::UTF8.GetString($plain)
}
if ($ClientId) {
  $env:FADI_BROWSER_V2_CLIENT_ID = $ClientId
}
$sourceRoot = Get-V2SourceRoot
& node (Join-Path $sourceRoot 'src\mcp-stdio.mjs')
exit $LASTEXITCODE
