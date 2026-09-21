[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'stop.ps1') -PreserveForRestart
& (Join-Path $PSScriptRoot 'start.ps1')
