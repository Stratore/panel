<#
  Panel - installation du lanceur Windows (une seule fois).

  Prérequis : WSL avec une distribution Linux, Docker Engine dedans, et ce dépôt cloné dans la
  distribution avec un fichier deploy/.env (voir docs/DEPLOYMENT.md, « Serveur local Windows »).

  Crée dans %LOCALAPPDATA%\Panel le lanceur, sa configuration et l'icône, puis les raccourcis
  « Panel » sur le bureau et dans le menu Démarrer.
    powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1 [-Distro Ubuntu] [-DeployDir /home/moi/panel/deploy]
#>
param(
  [string]$Distro = 'Ubuntu',
  [string]$DeployDir = '',
  [string]$Url = 'https://localhost'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Say([string]$text) { Write-Host "  $text" }

# --- Where Panel lives in WSL ------------------------------------------------------------------
if (-not $DeployDir) {
  $linuxHome = (& wsl.exe -d $Distro --cd '~' -- pwd | Out-String).Trim()
  $DeployDir = "$linuxHome/panel/deploy"
}
& wsl.exe -d $Distro --cd $DeployDir -- test -f compose.yaml -a -f .env -a -f scripts/local.sh
if ($LASTEXITCODE -ne 0) {
  throw "Pas de compose.yaml, .env ou scripts/local.sh dans $DeployDir ($Distro)."
}

$target = Join-Path $env:LOCALAPPDATA 'Panel'
$backupDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Panel\sauvegardes'
New-Item -ItemType Directory -Force -Path $target, $backupDir | Out-Null
$backupDirWsl = (& wsl.exe -d $Distro -- wslpath -a ($backupDir -replace '\\', '/') | Out-String).Trim()

# --- Launcher and its configuration ------------------------------------------------------------
$utf8Bom = New-Object Text.UTF8Encoding $true
$launcher = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'panel.ps1')).TrimStart([char]0xFEFF)
[IO.File]::WriteAllText((Join-Path $target 'panel.ps1'), $launcher, $utf8Bom)
$trust = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'trust-certificate.ps1')).TrimStart([char]0xFEFF)
[IO.File]::WriteAllText((Join-Path $target 'trust-certificate.ps1'), $trust, $utf8Bom)
[ordered]@{
  distro       = $Distro
  deployDir    = $DeployDir
  url          = $Url
  backupDir    = $backupDir
  backupDirWsl = $backupDirWsl
} | ConvertTo-Json | Set-Content -Encoding UTF8 -Path (Join-Path $target 'panel.json')
Say "Lanceur installé dans $target"

# --- Icon: the shapes of apps/web/public/icon.svg (28 x 28 grid), drawn at each icon size --------
Add-Type -AssemblyName System.Drawing

function Add-RoundedRect($graphics, [string]$color, [double]$scale, [double]$x, [double]$y, [double]$w, [double]$h, [double]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $x *= $scale; $y *= $scale; $w *= $scale; $h *= $scale; $d = 2 * $r * $scale
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color))
  $graphics.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose()
}

function New-IconPng([int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 28.0
  Add-RoundedRect $graphics '#1D1D1F' $s 0 0 28 28 8
  Add-RoundedRect $graphics '#F5F5F7' $s 6 6 7 16 2
  Add-RoundedRect $graphics '#F5F5F7' $s 15 6 7 7 2
  Add-RoundedRect $graphics '#2E5BFF' $s 15 15 7 7 2
  $stream = New-Object IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $bitmap.Dispose()
  return , $stream.ToArray()
}

# ICO container with PNG-compressed images (supported since Windows Vista).
$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$images = foreach ($size in $sizes) { , (New-IconPng $size) }
$iconPath = Join-Path $target 'panel.ico'
$file = New-Object IO.MemoryStream
$writer = New-Object IO.BinaryWriter $file
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dimension = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
  $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32)
  $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
  $offset += $images[$i].Length
}
foreach ($image in $images) { $writer.Write($image) }
$writer.Flush()
[IO.File]::WriteAllBytes($iconPath, $file.ToArray())
$writer.Dispose()
Say "Icône créée : $iconPath"

# --- Shortcuts --------------------------------------------------------------------------------
$shell = New-Object -ComObject WScript.Shell
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Panel'
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null

function New-Shortcut([string]$path, [string]$arguments, [string]$description, [string]$script = 'panel.ps1') {
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = $powershell
  # Bypass applies to this process only; the system execution policy is unchanged.
  $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$target\$script`" $arguments".Trim()
  $link.WorkingDirectory = $target
  $link.IconLocation = "$iconPath,0"
  $link.Description = $description
  $link.WindowStyle = 1
  $link.Save()
}

$desktop = [Environment]::GetFolderPath('Desktop')
New-Shortcut (Join-Path $desktop 'Panel.lnk') '' 'Démarrer Panel et l''ouvrir dans le navigateur'
New-Shortcut (Join-Path $startMenu 'Panel.lnk') '' 'Démarrer Panel et l''ouvrir dans le navigateur'
New-Shortcut (Join-Path $startMenu 'Arrêter Panel.lnk') '-Stop' 'Arrêter Panel'
New-Shortcut (Join-Path $startMenu 'Mettre à jour Panel.lnk') '-Update' 'Mettre à jour Panel depuis GitHub'
New-Shortcut (Join-Path $startMenu 'Sauvegarder Panel.lnk') '-Backup' 'Sauvegarder la base de Panel dans Documents'
New-Shortcut (Join-Path $startMenu 'Panel - Certificat.lnk') '' 'Faire confiance au certificat local de Panel (supprime l''avertissement du navigateur)' 'trust-certificate.ps1'
Say 'Raccourcis créés : bureau et menu Démarrer (Panel, Arrêter, Mettre à jour, Sauvegarder, Certificat).'
