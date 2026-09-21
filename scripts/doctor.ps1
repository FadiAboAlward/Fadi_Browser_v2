[CmdletBinding()]
param()
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')

$config = try { Get-V2Config } catch { $null }
$port = if ($config) { [int]$config.port } else { 8951 }
$v1Ports = @(8931,8932,8933,8941,8942,8943)
$v1 = foreach ($p in $v1Ports) {
  $client = [Net.Sockets.TcpClient]::new()
  try { $ok = $client.ConnectAsync('127.0.0.1',$p).Wait(1200) -and $client.Connected }
  catch { $ok = $false }
  finally { $client.Dispose() }
  [pscustomobject]@{ Port=$p; Listening=$ok }
}
$engineVersion = try { (& npx --no-install agent-browser --version 2>$null) -join '' } catch { 'unavailable' }
$health = Test-V2Health
$task = Get-ScheduledTask -TaskName 'Fadi Browser V2' -ErrorAction SilentlyContinue

[pscustomobject]@{
  ConfigPresent = [bool]$config
  RuntimeWritable = Test-Path -LiteralPath $script:RuntimeRoot
  AgentBrowser = $engineVersion
  V2Port = $port
  V2PortCollidesWithV1 = $v1Ports -contains $port
  Broker = if ($health) { $health.broker } else { 'DOWN' }
  MCP = if ($health) { $health.mcp } else { 'DOWN' }
  StartupTask = if ($task) { [string]$task.State } else { 'MISSING' }
  V1Ports = ($v1 | ConvertTo-Json -Compress)
  V1Modified = $false
} | Format-List

if (-not $config -or ($v1Ports -contains $port) -or $engineVersion -notmatch '0\.38\.1') { exit 1 }
