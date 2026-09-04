param([string]$NodePath = '')

$ErrorActionPreference = 'Stop'
$dashboardDirectory = $PSScriptRoot
$serverFile = Join-Path $dashboardDirectory 'server.js'
$dashboardUrl = 'http://localhost:8420/dashboard.html'
$probeUrl = 'http://127.0.0.1:8420/dashboard.html'
$logDirectory = Join-Path $env:LOCALAPPDATA 'OfferTrack'
[IO.Directory]::CreateDirectory($logDirectory) | Out-Null

function Test-OfferTrackReady {
    try {
        $response = Invoke-WebRequest -Uri $probeUrl -UseBasicParsing -TimeoutSec 3
        return ($response.StatusCode -eq 200 -and $response.Content -match '<title>OfferTrack')
    } catch { return $false }
}

# Serialize manual and login launches so they cannot start two servers at once.
$launchMutex = [Threading.Mutex]::new($false, 'Local\OfferTrack-Dashboard-8420-Launch')
$lockAcquired = $false
try {
    try { $lockAcquired = $launchMutex.WaitOne(15000) }
    catch [Threading.AbandonedMutexException] { $lockAcquired = $true }
    if (-not $lockAcquired) { throw 'Another OfferTrack launcher is still starting. Please retry shortly.' }
    if (Test-OfferTrackReady) {
        Write-Output ('OfferTrack is already available: ' + $dashboardUrl)
        exit 0
    }
    $portOwner = Get-NetTCPConnection -LocalPort 8420 -State Listen -ErrorAction SilentlyContinue
    if ($portOwner) { throw 'Port 8420 is occupied, but it is not serving the OfferTrack dashboard.' }
    if (-not $NodePath) { $NodePath = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Node.js could not be found. Reinstall the startup shortcut after updating Node.js.' }
    if (-not (Test-Path -LiteralPath $serverFile -PathType Leaf)) { throw 'The dashboard server.js file is missing.' }
    $serverProcess = Start-Process -FilePath $NodePath -ArgumentList ('"' + $serverFile + '"') `
        -WorkingDirectory $dashboardDirectory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDirectory 'server.log') `
        -RedirectStandardError (Join-Path $logDirectory 'server-error.log')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (Test-OfferTrackReady) {
            [IO.File]::WriteAllText((Join-Path $logDirectory 'server-process.json'),
                (@{ processId = $serverProcess.Id; serverFile = $serverFile; nodePath = $NodePath; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json))
            Write-Output ('OfferTrack is running in the background: ' + $dashboardUrl)
            exit 0
        }
        $serverProcess.Refresh()
        if ($serverProcess.HasExited) { throw ('OfferTrack could not start. See ' + (Join-Path $logDirectory 'server-error.log')) }
        Start-Sleep -Milliseconds 250
    }
    throw ('The server did not respond in time. See ' + $logDirectory)
} catch {
    $failure = (Get-Date).ToString('o') + ' ' + $_.Exception.Message
    Add-Content -LiteralPath (Join-Path $logDirectory 'launcher-error.log') -Value $failure -Encoding UTF8
    Write-Error -Message $failure -ErrorAction Continue
    exit 1
} finally {
    if ($lockAcquired) { $launchMutex.ReleaseMutex() }
    $launchMutex.Dispose()
}
