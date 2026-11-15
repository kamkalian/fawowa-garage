# Lädt das Wegenetz für den Reichweiten-Planer auf den Server (nach /srv/apps/garage/data/netz) und startet die Anwendung neu.
#
# Aufruf:  .\deploy\netz-hochladen.ps1 -Netz C:\Pfad\zum\netz -Server 203.0.113.10 -User meinbenutzer
#   oder:  $env:FAWOWA_SERVER = '203.0.113.10'; $env:FAWOWA_USER = 'meinbenutzer'; .\deploy\netz-hochladen.ps1 -Netz ...
# Das Netz erzeugt tools/routing/bauen.js (siehe docs/ROUTING-TEST.md). Es ist etwa 100 MB groß (NRW).

param(
  [Parameter(Mandatory = $true)][string]$Netz,
  [string]$Server = $env:FAWOWA_SERVER,
  [string]$User = $env:FAWOWA_USER,
  [string]$Key = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_fawowa'),
  [string]$Ziel = '/srv/apps/garage'
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 macht aus jeder Zeile, die ein Programm auf stderr schreibt, einen Fehler (Docker meldet damit seinen Fortschritt).
# Programme laufen deshalb mit 'Continue'; geprüft wird nur der Exit-Code.
function Invoke-Nativ([scriptblock]$Block) {
  $vorher = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Block } finally { $ErrorActionPreference = $vorher }
}
if (-not $Server) { throw 'Bitte -Server angeben oder $env:FAWOWA_SERVER setzen.' }
if (-not $User) { throw 'Bitte -User angeben oder $env:FAWOWA_USER setzen.' }
if (-not (Test-Path (Join-Path $Netz 'info.json'))) { throw "In $Netz liegt kein Wegenetz (info.json fehlt)." }

$archiv = Join-Path $env:TEMP 'garage-netz.tar.gz'
if (Test-Path $archiv) { Remove-Item $archiv }
Write-Host '1/3 Netz packen ...'
tar -czf $archiv -C $Netz .
if ($LASTEXITCODE -ne 0) { throw 'tar ist fehlgeschlagen.' }

Write-Host '2/3 Auf den Server kopieren ...'
Invoke-Nativ { scp -i $Key -o IdentitiesOnly=yes $archiv "${User}@${Server}:/tmp/garage-netz.tar.gz" }
if ($LASTEXITCODE -ne 0) { throw 'scp ist fehlgeschlagen.' }

Write-Host '3/3 Entpacken und neu starten ...'
# Erst in einen neuen Ordner entpacken und dann tauschen, damit die laufende Anwendung nie ein halbes Netz sieht
Invoke-Nativ { ssh -i $Key -o IdentitiesOnly=yes "${User}@${Server}" "set -e; cd $Ziel/data && rm -rf netz.neu && mkdir netz.neu && tar -xzf /tmp/garage-netz.tar.gz -C netz.neu && rm -f /tmp/garage-netz.tar.gz && rm -rf netz.alt && { [ -d netz ] && mv netz netz.alt || true; } && mv netz.neu netz && rm -rf netz.alt && cd $Ziel && docker compose up -d --force-recreate garage 2>&1" }
if ($LASTEXITCODE -ne 0) { throw 'Entpacken oder Neustart ist fehlgeschlagen.' }
Write-Host 'Fertig.'
