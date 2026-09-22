# Registers a scheduled task that starts the bridge when you log in.
[CmdletBinding()]
param(
    [ValidateSet('install', 'uninstall', 'status')]
    [string]$Action = 'install',

    [string]$TaskName = 'claudetalk',

    # A logon trigger can fire before the network is up, which surfaces as a login failure.
    [int]$DelaySeconds = 30
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-bridge.ps1'

function Get-Task {
    Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

switch ($Action) {
    'status' {
        $task = Get-Task
        if (-not $task) {
            Write-Output "Not installed. Run: powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1"
            break
        }
        $info = Get-ScheduledTaskInfo -TaskName $TaskName
        Write-Output "Task:        $TaskName"
        Write-Output "State:       $($task.State)"
        Write-Output "Last run:    $($info.LastRunTime)  (result $($info.LastTaskResult))"
        Write-Output "Log:         $(Join-Path $projectRoot 'data\bridge.log')"
    }

    'uninstall' {
        if (-not (Get-Task)) {
            Write-Output "Nothing to remove; $TaskName is not registered."
            break
        }
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Output "Removed $TaskName. The bridge will not start on its own any more."
        Write-Output "It is still running if you started it by hand; use npm run stop."
    }

    'install' {
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) {
            throw "No .env in $projectRoot. Copy .env.example and fill it in before installing autostart."
        }

        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $isAdmin = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)
        if (-not $isAdmin) {
            Write-Output "Registering a windowless task needs administrator rights. Asking for them now."
            # One quoted absolute path: Start-Process neither quotes a path with spaces nor honours -WorkingDirectory under RunAs.
            $relaunch = '-NoProfile -NoExit -ExecutionPolicy Bypass -File "{0}" -Action install -TaskName "{1}"' -f
                $PSCommandPath, $TaskName
            try {
                Start-Process powershell -Verb RunAs -ArgumentList $relaunch
                Write-Output "Continuing in the elevated window that just opened."
            } catch {
                throw ("Administrator rights were refused, so the task was not registered. " +
                    "Open PowerShell as administrator and run the same command again.")
            }
            break
        }

        $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $runner
        $taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $projectRoot

        # Starting at boot as well as at logon means a reboot needs nobody to sign in.
        $atStartup = New-ScheduledTaskTrigger -AtStartup
        $atStartup.Delay = "PT${DelaySeconds}S"
        $atLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
        $atLogon.Delay = "PT${DelaySeconds}S"

        # S4U runs as the user with no desktop session, so no console window exists to be closed.
        $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -DontStopOnIdleEnd `
            -RestartCount 3 `
            -RestartInterval (New-TimeSpan -Minutes 2) `
            -MultipleInstances IgnoreNew `
            -ExecutionTimeLimit ([TimeSpan]::Zero)

        if (Get-Task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }

        Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger @($atStartup, $atLogon) `
            -Principal $principal -Settings $settings `
            -Description 'Starts the Claude Discord bridge at boot and at logon.' | Out-Null

        Write-Output "Installed $TaskName."
        Write-Output "Starts $DelaySeconds seconds after boot and after logon, retries 3 times if it exits."
        Write-Output "No console window: it runs with no desktop session, so there is nothing to close."
        Write-Output "Log:    $(Join-Path $projectRoot 'data\bridge.log')"
        Write-Output ""
        Write-Output "Start it now:  Start-ScheduledTask -TaskName $TaskName"
        Write-Output "Remove it:     powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Action uninstall"
    }
}
