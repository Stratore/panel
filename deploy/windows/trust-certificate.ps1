<#
  Panel - faire confiance au certificat local (optionnel, à lancer soi-même).

  Caddy signe le certificat de https://localhost avec sa propre autorité, créée sur ce PC et
  gardée dans le volume Docker « caddy_data ». Ce script ajoute cette autorité aux autorités
  racines de confiance de TON compte Windows (pas de la machine) : plus d'avertissement dans
  Edge et Chrome. Windows demande une confirmation ; Firefox garde son propre magasin.

    powershell -ExecutionPolicy Bypass -File deploy\windows\trust-certificate.ps1
  Pour l'enlever : certmgr.msc > Autorités de certification racines de confiance >
  « Caddy Local Authority ».
#>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$config = Get-Content -Raw -Path (Join-Path $env:LOCALAPPDATA 'Panel\panel.json') | ConvertFrom-Json
$certificate = Join-Path $env:TEMP 'panel-root.crt'
$certificateWsl = (& wsl.exe -d $config.distro -- wslpath -a ($certificate -replace '\\', '/') | Out-String).Trim()

& wsl.exe -d $config.distro -u root --cd $config.deployDir -- docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt $certificateWsl
if ($LASTEXITCODE -ne 0) { throw 'Certificat introuvable : Panel doit avoir démarré au moins une fois.' }

$details = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $certificate
Write-Host "  Autorité : $($details.Subject)"
Write-Host "  Empreinte : $($details.Thumbprint)"
& certutil.exe -user -addstore Root $certificate | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Ajout refusé ou annulé.' }
Remove-Item $certificate
Write-Host '  Fait. Redémarre le navigateur pour ne plus voir l''avertissement.'
