<#
  Panel - faire confiance au certificat local (optionnel, à lancer soi-même).

  Caddy signe le certificat de https://localhost avec sa propre autorité, créée sur ce PC et
  gardée dans le volume Docker « caddy_data ». Ce script ajoute cette autorité aux autorités
  racines de confiance de TON compte Windows (pas de la machine) : plus d'avertissement dans
  Edge et Chrome. Windows demande une confirmation ; Firefox garde son propre magasin.

    Menu Démarrer > Panel > « Panel - Certificat » (créé par install.ps1).
  Pour l'enlever : certmgr.msc > Autorités de certification racines de confiance >
  « Caddy Local Authority ».
#>
# Native commands (wsl, certutil) are judged by their exit code, not by what they print on
# stderr, which Windows PowerShell would otherwise turn into terminating errors.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = 'Panel - certificat'

try {
  # Installed next to panel.ps1 and panel.json by install.ps1.
  $folder = $PSScriptRoot
  $config = Get-Content -ErrorAction Stop -Raw -Path (Join-Path $folder 'panel.json') | ConvertFrom-Json -ErrorAction Stop
  # A long path: WSL cannot open Windows 8.3 short names such as PUGET_~1.
  $certificate = Join-Path $folder 'panel-root.crt'
  $certificateWsl = (& wsl.exe -d $config.distro -- wslpath -a ($certificate -replace '\\', '/') | Out-String).Trim()

  & wsl.exe -d $config.distro -u root --cd $config.deployDir -- docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt $certificateWsl
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $certificate)) {
    throw 'Certificat introuvable : lance Panel au moins une fois avec l''icône du bureau.'
  }

  $details = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $certificate -ErrorAction Stop
  Write-Host ''
  Write-Host "  Autorité  : $($details.Subject)"
  Write-Host "  Empreinte : $($details.Thumbprint)"
  Write-Host ''
  Write-Host '  Windows va demander une confirmation : réponds Oui.'
  $result = & certutil.exe -user -addstore Root $certificate 2>&1 | Out-String
  $code = $LASTEXITCODE
  Remove-Item $certificate -ErrorAction SilentlyContinue
  if ($code -ne 0) { throw "Ajout refusé ou annulé.`n$result" }
  Write-Host '  Fait. Ferme et rouvre le navigateur : l''avertissement disparaît.' -ForegroundColor Green
} catch {
  Write-Host "  Erreur : $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ''
Read-Host '  Appuie sur Entrée pour fermer' | Out-Null
