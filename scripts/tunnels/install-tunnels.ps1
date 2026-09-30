$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$templatePath = Join-Path $PSScriptRoot 'start-tunnel-template.ps1'

function Install-Tunnel {
    param([string]$AppRoot, [string]$ProfileName, [string]$ClientId, [string]$TaskName)
    
    if (-not (Test-Path -LiteralPath $AppRoot)) {
        Write-Warning "AppRoot $AppRoot not found. Skipping tunnel $TaskName."
        return
    }

    $targetScript = Join-Path $AppRoot 'start-tunnel.ps1'
    Copy-Item -LiteralPath $templatePath -Destination $targetScript -Force

    $args = "-NoLogo -NoProfile -NonInteractive -WindowStyle Minimized -ExecutionPolicy Bypass -File `"$targetScript`" -AppRoot `"$AppRoot`" -ProfileName `"$ProfileName`" -ClientId `"$ClientId`""
    $action = New-ScheduledTaskAction -Execute $powerShell -Argument $args
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal
    $task.Settings.Hidden = $true
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
    Write-Host "Configured tunnel task: $TaskName"
}

Install-Tunnel -AppRoot "$env:LOCALAPPDATA\Antigravity\FadiGPT" -ProfileName "fadi-gpt.yaml" -ClientId "fadi-gpt" -TaskName "Fadi Browser V2 - Fadi GPT Tunnel"
Install-Tunnel -AppRoot "$env:LOCALAPPDATA\Antigravity\GoilotGPT" -ProfileName "goilot-gpt.yaml" -ClientId "goilot-gpt" -TaskName "Fadi Browser V2 - Goilot GPT Tunnel"