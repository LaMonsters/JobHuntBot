$ErrorActionPreference = 'Stop'
$launcherFile = Join-Path $PSScriptRoot 'start-dashboard-background.ps1'
$nodePath = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$powershellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startupDirectory = [Environment]::GetFolderPath('Startup')
if (-not $startupDirectory) { throw 'Windows Startup folder is unavailable.' }
if (-not (Test-Path -LiteralPath $launcherFile)) { throw 'OfferTrack background launcher is missing.' }
[IO.Directory]::CreateDirectory($startupDirectory) | Out-Null
$shortcutPath = Join-Path $startupDirectory 'OfferTrack.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherFile + '" -NodePath "' + $nodePath + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Start the local OfferTrack dashboard silently when signing in to Windows.'
$shortcut.Save()
Write-Output ('OfferTrack automatic startup installed for this Windows account: ' + $shortcutPath)
