<#
  Panel - lanceur Windows (icône du bureau).

  Démarre Panel dans WSL (Docker), attend qu'il soit prêt, puis l'ouvre dans le navigateur.
    panel.ps1            démarrer et ouvrir
    panel.ps1 -Stop      arrêter Panel (les données sont conservées)
    panel.ps1 -Update    mettre à jour depuis GitHub, reconstruire et redémarrer
    panel.ps1 -Backup    sauvegarder maintenant dans le dossier de sauvegarde

  Installé par deploy/windows/install.ps1, qui écrit panel.json à côté de ce fichier.
#>
param([switch]$Stop, [switch]$Update, [switch]$Backup)

$ErrorActionPreference = 'Stop'
# wsl.exe output is UTF-8: decode it as such (accents, file contents).
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = 'Panel'

$config = Get-Content -Raw -Path (Join-Path $PSScriptRoot 'panel.json') | ConvertFrom-Json
$distro = $config.distro
$deployDir = $config.deployDir
$url = $config.url
$backupDir = $config.backupDir
$backupDirWsl = $config.backupDirWsl
$keepAliveTag = 'panel-keepalive'

function Say([string]$text) { Write-Host "  $text" }

function Stop-WithError([string]$text) {
  Write-Host ''
  Write-Host "  Erreur : $text" -ForegroundColor Red
  Write-Host ''
  Write-Host '  Détails : wsl -d' $distro '-u root --cd' $deployDir '-- docker compose logs'
  Read-Host '  Appuie sur Entrée pour fermer' | Out-Null
  exit 1
}

# Runs scripts/local.sh inside WSL as root (Docker), from the deployment folder.
function Invoke-Local([string[]]$arguments) {
  $output = & wsl.exe -d $distro -u root --cd $deployDir -- bash scripts/local.sh @arguments 2>&1
  $text = ($output | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw $text }
  return $text
}

# WSL stops its virtual machine a few seconds after the last Windows-side process exits, which
# would stop Panel too. A hidden, idle process keeps it running while Windows is on.
function Start-KeepAlive {
  $running = Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" |
    Where-Object { $_.CommandLine -like "*$keepAliveTag*" }
  if (-not $running) {
    Start-Process -FilePath 'wsl.exe' -WindowStyle Hidden -ArgumentList @(
      '-d', $distro, '--exec', 'bash', '-c', "exec -a $keepAliveTag sleep infinity")
  }
}

function Stop-KeepAlive {
  Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" |
    Where-Object { $_.CommandLine -like "*$keepAliveTag*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

function Invoke-Backup {
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Say 'Sauvegarde de la base…'
  $result = Invoke-Local @('backup', $backupDirWsl)
  Say ($result -split "`n" | Select-Object -Last 1)
}

# A copy outside WSL, at most once a day: if the WSL distribution is lost, the data is not.
function Invoke-DailyBackup {
  $latest = Get-ChildItem -Path $backupDir -Filter 'panel-*.db' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest -or $latest.LastWriteTime -lt (Get-Date).AddHours(-20)) {
    try { Invoke-Backup } catch { Say "Sauvegarde ignorée : $($_.Exception.Message)" }
  }
}

try {
  if ($Stop) {
    Say 'Arrêt de Panel…'
    Invoke-Local @('stop') | Out-Null
    Stop-KeepAlive
    Say 'Panel est arrêté.'
    Start-Sleep -Seconds 2
    exit 0
  }

  Write-Host ''
  Say 'Démarrage de Panel…'
  Start-KeepAlive

  if ($Update) {
    Say 'Mise à jour depuis GitHub et reconstruction (quelques minutes)…'
    Say (Invoke-Local @('update'))
    # The launcher itself may have changed: refresh this copy for the next start.
    $fresh = & wsl.exe -d $distro --cd $deployDir -- cat windows/panel.ps1 | Out-String
    if ($LASTEXITCODE -eq 0 -and $fresh.Length -gt 1000) {
      [IO.File]::WriteAllText($PSCommandPath, $fresh.TrimStart([char]0xFEFF), (New-Object Text.UTF8Encoding $true))
    }
  } else {
    Say 'Lancement des conteneurs (jusqu''à quelques minutes la première fois)…'
    Invoke-Local @('start') | Out-Null
  }

  if ($Backup) { Invoke-Backup } else { Invoke-DailyBackup }

  $token = Invoke-Local @('setup-token')
  if ($token) {
    # First start: no account yet. The one-time token is needed on the /setup page.
    Set-Clipboard -Value $token
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      "Premier lancement : crée ton compte sur la page qui va s'ouvrir.`n`n" +
      "Le jeton d'installation est copié dans le presse-papiers (Ctrl+V dans « Setup token »).",
      'Panel', 'OK', 'Information') | Out-Null
    Start-Process "$url/setup"
  } else {
    Start-Process $url
  }
  Say 'Panel est prêt.'
  Start-Sleep -Seconds 2
} catch {
  Stop-WithError $_.Exception.Message
}
