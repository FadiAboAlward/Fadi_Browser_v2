[CmdletBinding(SupportsShouldProcess)]
param([switch]$RemoveAuthState)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

& (Join-Path $PSScriptRoot 'stop.ps1') -Force -ErrorAction SilentlyContinue | Out-Null
Unregister-ScheduledTask -TaskName 'Fadi Browser V2' -Confirm:$false -ErrorAction SilentlyContinue

$resolved = [IO.Path]::GetFullPath($script:RuntimeRoot)
$expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'FadiBrowserV2'))
if (-not $resolved.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to uninstall from an unexpected runtime root.' }

if ($RemoveAuthState) {
  if ($PSCmdlet.ShouldProcess($resolved, 'Remove all Fadi Browser V2 runtime and auth state')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
  $authResult = 'removed'
} else {
  foreach ($name in @('data','logs','state','diagnostics','qa','deployments')) {
    $target = Join-Path $resolved $name
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  }
  $authResult = 'preserved'
}
[pscustomobject]@{ Uninstalled=$true; AuthState=$authResult; V1Modified=$false; Recoverable=($authResult -eq 'preserved') } | Format-List
