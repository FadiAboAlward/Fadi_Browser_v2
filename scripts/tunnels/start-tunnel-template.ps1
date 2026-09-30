[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$AppRoot,
  [Parameter(Mandatory=$true)][string]$ProfileName,
  [Parameter(Mandatory=$true)][string]$ClientId
)

Add-Type -AssemblyName System.Security

$SecretPath = Join-Path $AppRoot 'secrets\control-plane-api-key.dpapi'
$BrokerSecretPath = Join-Path $AppRoot 'secrets\broker-token.dpapi'
$ProfilePath = Join-Path $AppRoot $ProfileName
$TunnelExe = Join-Path $AppRoot 'tunnel\tunnel-client.exe'

if (-not (Test-Path -LiteralPath $SecretPath)) {
  Write-Error "Secret path $SecretPath does not exist."
  exit 1
}
if (-not (Test-Path -LiteralPath $BrokerSecretPath)) {
  Write-Error 'The DPAPI-protected Fadi Browser V2 broker token does not exist.'
  exit 3
}

$cipherBytes = [IO.File]::ReadAllBytes($SecretPath)
$entropy = [Text.Encoding]::UTF8.GetBytes('FadiBrowserV2.TunnelKey')
$brokerEntropy = [Text.Encoding]::UTF8.GetBytes('Fadi Browser V2')

try {
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $cipherBytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $brokerCipherBytes = [Convert]::FromBase64String(
    (Get-Content -LiteralPath $BrokerSecretPath -Raw).Trim()
  )
  $brokerPlainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $brokerCipherBytes,
    $brokerEntropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
} catch {
  Write-Error "Failed to decrypt a required local credential: $($_.Exception.Message)"
  exit 2
}

try {
  $plain = [Text.Encoding]::UTF8.GetString($plainBytes)
  $brokerToken = [Text.Encoding]::UTF8.GetString($brokerPlainBytes)
  $probeSuccess = $false
  $body = "{`"client_id`":`"$ClientId`"}"
  for ($i = 0; $i -lt 15; $i++) {
    try {
      $brokerProbe = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:8951/v1/status' -Headers @{ 'X-Fadi-Browser-Token' = $brokerToken } -ContentType 'application/json' -Body $body -TimeoutSec 5 -ErrorAction Stop
      if ($brokerProbe.StatusCode -eq 200) { $probeSuccess = $true; break }
    } catch {
      Start-Sleep -Seconds 3
    }
  }
  if (-not $probeSuccess) {
    throw "The $ClientId local broker credential did not pass validation after waiting."
  }
  $env:CONTROL_PLANE_API_KEY = $plain
  $env:FADI_BROWSER_V2_API_TOKEN = $brokerToken
  $env:MCP_EXTRA_HEADERS = "X-Fadi-Browser-Token: $brokerToken"
  $env:MCP_DISCOVERY_EXTRA_HEADERS = "X-Fadi-Browser-Token: $brokerToken"
  
  # Run the tunnel in the foreground
  & $TunnelExe run --profile-file $ProfilePath
} finally {
  Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:FADI_BROWSER_V2_API_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:MCP_EXTRA_HEADERS -ErrorAction SilentlyContinue
  Remove-Item Env:MCP_DISCOVERY_EXTRA_HEADERS -ErrorAction SilentlyContinue
  if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  if ($brokerPlainBytes) { [Array]::Clear($brokerPlainBytes, 0, $brokerPlainBytes.Length) }
  if ($brokerCipherBytes) { [Array]::Clear($brokerCipherBytes, 0, $brokerCipherBytes.Length) }
}