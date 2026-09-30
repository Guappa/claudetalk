# Entry point for the scheduled task: rotates the log, then runs the bridge in the foreground.
[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [int]$MaxLogBytes = 5MB
)

# $PSScriptRoot is not populated inside a param default on Windows PowerShell 5.1.
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }

Set-Location -LiteralPath $ProjectRoot

$logDir = Join-Path $ProjectRoot 'data'
$logPath = Join-Path $logDir 'bridge.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if ((Test-Path -LiteralPath $logPath) -and ((Get-Item -LiteralPath $logPath).Length -gt $MaxLogBytes)) {
    Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
}

# Appended through cmd so the log stays readable while the bridge runs, redirect first because cmd reads a digit straight before >> as a handle number and eats it.
function Write-BridgeLog([string]$Message) {
    & cmd.exe /c ">> `"$logPath`" echo $Message" | Out-Null
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-BridgeLog "$(Get-Date -Format o)  node is not on PATH for this session; the bridge cannot start."
    exit 1
}

Write-BridgeLog "$(Get-Date -Format o)  starting bridge"

& cmd.exe /c "`"$node`" --env-file-if-exists=.env --experimental-strip-types src/index.ts >> `"$logPath`" 2>&1"
$code = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }

Write-BridgeLog "$(Get-Date -Format o)  bridge exited with code $code"
exit $code
