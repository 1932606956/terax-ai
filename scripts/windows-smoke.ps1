# Windows smoke test for a Terax build.
#
# Launches the binary with its own control descriptor directory (TERAX_CONTROL_DIR)
# so a running Terax instance is never displaced, then asserts the app is alive,
# its control plane answers, and the frontend has mounted.
#
# Usage:
#   pwsh -File scripts/windows-smoke.ps1                      # installed app
#   pwsh -File scripts/windows-smoke.ps1 -Exe target/debug/terax.exe
#   pwsh -File scripts/windows-smoke.ps1 -Cli <terax-cli.exe> -Verbose
#
# Exit codes: 0 pass, 1 assertion failed, 2 setup error.

[CmdletBinding()]
param(
    [string]$Exe = "$env:LOCALAPPDATA\terax\terax.exe",
    [string]$Cli,
    [int]$LaunchTimeoutSec = 30,
    [int]$ProbeTimeoutSec = 20,
    [switch]$KeepRunning,
    [switch]$KeepArtifacts
)

$ErrorActionPreference = 'Stop'
$script:Failures = @()
$script:Checks = @()

function Write-Step([string]$Message) {
    Write-Host "  $Message"
}

function Add-Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
    $script:Checks += [pscustomobject]@{ Name = $Name; Ok = $Ok; Detail = $Detail }
    if (-not $Ok) { $script:Failures += $Name }
    $mark = if ($Ok) { 'PASS' } else { 'FAIL' }
    $suffix = if ($Detail) { " ($Detail)" } else { '' }
    Write-Host "  [$mark] $Name$suffix"
}

function Resolve-CliPath([string]$ExePath, [string]$Requested) {
    if ($Requested) {
        if (-not (Test-Path -LiteralPath $Requested)) { throw "CLI not found: $Requested" }
        return (Resolve-Path -LiteralPath $Requested).Path
    }
    $dir = Split-Path -Parent $ExePath
    $beside = Join-Path $dir 'terax-cli.exe'
    if (Test-Path -LiteralPath $beside) { return $beside }
    $installed = Join-Path $env:LOCALAPPDATA 'terax\terax-cli.exe'
    if (Test-Path -LiteralPath $installed) { return $installed }
    throw "Could not locate terax-cli.exe. Pass -Cli, or build it with 'pnpm build:cli:dev'."
}

function Invoke-Cli([string]$CliPath, [string]$ControlDir, [string[]]$CliArgs) {
    $env:TERAX_CONTROL_DIR = $ControlDir
    # The CLI reports errors as JSON on stderr; with the script-wide
    # ErrorActionPreference=Stop, 2>&1 turns that into a terminating error
    # and the retry loop never gets to read the exit code.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & $CliPath @CliArgs 2>&1
        $code = $LASTEXITCODE
    } catch {
        return [pscustomobject]@{ ExitCode = -1; Output = "spawn failed: $($_.Exception.Message)" }
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{ ExitCode = $code; Output = (($raw | Out-String).Trim()) }
}

function Wait-ForDescriptor([string]$Path, [int]$TimeoutSec, [Diagnostics.Process]$Process) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $Path) { return $true }
        if ($Process -and $Process.HasExited) { return $false }
        Start-Sleep -Milliseconds 200
    }
    return $false
}

function Stop-Tree([int]$ProcessId) {
    # Terax spawns sh/PowerShell children and WebView2 processes; kill the tree.
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
}

function Stop-OrphanedWebViews {
    # A crashed run leaves WebView2 children behind holding the shared
    # app.crynta.terax data directory, and the next launch then fails to
    # create its webview with 0x800700AA ("resource in use").
    $orphans = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'app\.crynta\.terax' })
    foreach ($orphan in $orphans) {
        Stop-Process -Id $orphan.ProcessId -Force -ErrorAction SilentlyContinue
    }
    return $orphans.Count
}

Write-Host "Terax Windows smoke test"
Write-Host ""

# --- setup ---------------------------------------------------------------
$exePath = if (Test-Path -LiteralPath $Exe) { (Resolve-Path -LiteralPath $Exe).Path } else { $null }
if (-not $exePath) {
    Write-Host "  [FAIL] executable not found: $Exe"
    Write-Host ""
    Write-Host "Pass -Exe <path> or build the app first."
    exit 2
}

$cliPath = Resolve-CliPath -ExePath $exePath -Requested $Cli
$workDir = Join-Path ([IO.Path]::GetTempPath()) ("terax-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 12))
$controlDir = Join-Path $workDir 'control'
$runDir = Join-Path $workDir 'bin'
New-Item -ItemType Directory -Force -Path $workDir, $controlDir, $runDir | Out-Null

# A process launched from a user profile folder on this machine is denied
# writes under %LOCALAPPDATA% (the log plugin aborts the startup with os
# error 5), while the same binary started from a temp directory writes
# normally. Run a copy from the scratch directory so the test measures the
# app rather than that folder policy.
$runExe = Join-Path $runDir (Split-Path -Leaf $exePath)
Copy-Item -LiteralPath $exePath -Destination $runExe -Force
# Ship the control helper beside the app like an installed bundle does, so the
# run exercises the same startup path (the app otherwise logs that the bundled
# CLI is missing and disables the shell alias).
$sidecar = Join-Path $runDir 'terax-cli.exe'
if (-not (Test-Path -LiteralPath $sidecar)) {
    Copy-Item -LiteralPath $cliPath -Destination $sidecar -Force
}
$exeVersion = (Get-Item -LiteralPath $exePath).VersionInfo.FileVersion
Write-Host "  exe:     $exePath"
Write-Host "  run as:  $runExe"
Write-Host "  version: $exeVersion"
Write-Host "  cli:     $cliPath"
Write-Host "  scratch: $workDir"
Write-Host ""

$process = $null
$descriptorPath = Join-Path $controlDir 'control.json'

$orphanCount = Stop-OrphanedWebViews
if ($orphanCount -gt 0) {
    Write-Host "  cleared $orphanCount orphaned WebView2 process(es)"
    Start-Sleep -Milliseconds 500
}

try {
    # --- launch ----------------------------------------------------------
    Add-Check 'descriptor directory starts empty' (-not (Test-Path -LiteralPath $descriptorPath))
    Add-Check 'executable version is set' ($exeVersion -match '^\d+\.\d+') $exeVersion

    Write-Step 'launching'
    $env:TERAX_CONTROL_DIR = $controlDir
    # Start-Process goes through ShellExecute, which raises the "unknown
    # publisher" consent prompt for unsigned executables and cancels when
    # nothing answers it. UseShellExecute=false calls CreateProcess directly.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $runExe
    $startInfo.WorkingDirectory = $runDir
    $startInfo.UseShellExecute = $false
    $startInfo.EnvironmentVariables['TERAX_CONTROL_DIR'] = $controlDir
    $process = [System.Diagnostics.Process]::Start($startInfo)
    Add-Check 'process started' ($null -ne $process -and -not $process.HasExited) "pid=$($process.Id)"

    $appeared = Wait-ForDescriptor -Path $descriptorPath -TimeoutSec $LaunchTimeoutSec -Process $process
    if ($process.HasExited) {
        Add-Check 'process survives launch' $false "exited with $($process.ExitCode)"
        throw "the app exited during startup"
    }
    Add-Check 'process survives launch' $true
    Add-Check 'control descriptor written' $appeared "within ${LaunchTimeoutSec}s"

    if ($appeared) {
        $descriptor = Get-Content -LiteralPath $descriptorPath -Raw | ConvertFrom-Json
        Add-Check 'descriptor names this process' ($descriptor.pid -eq $process.Id) "descriptor=$($descriptor.pid) app=$($process.Id)"
        Add-Check 'descriptor carries a token' ([bool]$descriptor.token)
        Add-Check 'descriptor address is loopback' ($descriptor.address -like '127.0.0.1:*') $descriptor.address
        Add-Check 'descriptor version matches exe' ($descriptor.app_version -eq $exeVersion) "$($descriptor.app_version) vs $exeVersion"
    }

    # --- control plane ---------------------------------------------------
    if ($appeared) {
        $deadline = (Get-Date).AddSeconds($ProbeTimeoutSec)
        $ping = $null
        while ((Get-Date) -lt $deadline) {
            $attempt = Invoke-Cli -CliPath $cliPath -ControlDir $controlDir -CliArgs @('ping', '--json')
            if ($attempt.ExitCode -eq 0 -and $attempt.Output -match '"ok"\s*:\s*true') { $ping = $attempt; break }
            Start-Sleep -Milliseconds 300
        }
        Add-Check 'ping succeeds' ($null -ne $ping) $(if ($ping) { '' } else { "exit=$($attempt.ExitCode) $($attempt.Output)" })

        if ($ping) {
            try {
                $pong = $ping.Output | ConvertFrom-Json
                Add-Check 'ping reports protocol 1' ($pong.result.protocol -eq 1) "protocol=$($pong.result.protocol)"
                Add-Check 'ping reports the exe version' ($pong.result.app_version -eq $exeVersion) $pong.result.app_version
            } catch {
                Add-Check 'ping output is JSON' $false $ping.Output
            }
        }

        # identify routes through React state, so a tab id proves the frontend
        # mounted and the IPC bridge is live. It answers frontend_not_ready
        # while the workspace is still restoring, so poll instead of failing.
        $deadline = (Get-Date).AddSeconds($ProbeTimeoutSec)
        $identify = $null
        $lastIdentify = $null
        $attempts = 0
        while ((Get-Date) -lt $deadline) {
            $attempts++
            $attempt = Invoke-Cli -CliPath $cliPath -ControlDir $controlDir -CliArgs @('identify', '--json')
            Write-Verbose "identify attempt ${attempts}: exit=$($attempt.ExitCode) $($attempt.Output)"
            $lastIdentify = $attempt
            if ($attempt.ExitCode -eq 0) { $identify = $attempt; break }
            if ($attempt.Output -notmatch 'frontend_not_ready') { break }
            Start-Sleep -Milliseconds 300
        }
        Add-Check 'identify succeeds' ($null -ne $identify) $(if ($null -eq $identify) { "after $attempts attempt(s): $($lastIdentify.Output)" } else { '' })
        if ($identify) {
            try {
                $id = $identify.Output | ConvertFrom-Json
                Add-Check 'frontend mounted (tab id present)' ([bool]$id.result.tab_id) "tab=$($id.result.tab_id) space=$($id.result.space_id)"
                Add-Check 'window context is main' ($id.result.window_id -eq 'main') $id.result.window_id
            } catch {
                Add-Check 'identify output is JSON' $false $identify.Output
            }
        }

        $caps = Invoke-Cli -CliPath $cliPath -ControlDir $controlDir -CliArgs @('capabilities', '--json')
        Add-Check 'capabilities succeeds' ($caps.ExitCode -eq 0) $(if ($caps.ExitCode -ne 0) { $caps.Output } else { '' })
    }

    # --- child processes -------------------------------------------------
    $childCount = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($process.Id)" -ErrorAction SilentlyContinue).Count
    Add-Check 'child processes spawned' ($childCount -gt 0) "count=$childCount"
}
catch {
    Add-Check 'run completed without exception' $false $_.Exception.Message
}
finally {
    if ($process -and -not $process.HasExited) {
        if ($KeepRunning) {
            Write-Host ""
            Write-Host "  leaving pid $($process.Id) running (-KeepRunning)"
        } else {
            Write-Step 'stopping'
            Stop-Tree -ProcessId $process.Id
            Start-Sleep -Milliseconds 800
            $process.Refresh()
            Add-Check 'process stopped' $process.HasExited
        }
    }

    if (-not $KeepArtifacts -and -not $KeepRunning) {
        Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
    } elseif (Test-Path -LiteralPath $workDir) {
        Write-Host "  artifacts: $workDir"
    }
    Remove-Item Env:\TERAX_CONTROL_DIR -ErrorAction SilentlyContinue
}

# --- result ---------------------------------------------------------------
Write-Host ""
$passed = @($script:Checks | Where-Object { $_.Ok }).Count
$total = @($script:Checks).Count
if ($script:Failures.Count -eq 0) {
    Write-Host "PASS $passed/$total checks"
    exit 0
}
Write-Host "FAIL $passed/$total checks"
$script:Failures | ForEach-Object { Write-Host "  - $_" }
exit 1
