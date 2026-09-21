[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$health = Test-V2Health
if (-not $health) {
  [pscustomobject]@{ Broker='DOWN'; MCP='DOWN'; BrowserEngine='UNKNOWN'; RuntimeRoot=$script:RuntimeRoot; V1Modified=$false } | Format-List
  exit 1
}
$health | Format-List
