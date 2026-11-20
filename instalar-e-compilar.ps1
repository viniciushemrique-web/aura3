# Alternativa local: instala tudo via winget e gera o instalador. Rode no PowerShell (como usuário normal).
$ErrorActionPreference = "Stop"
function Tem($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
if (-not (Tem "node"))  { winget install -e --id OpenJS.NodeJS.LTS }
if (-not (Tem "cargo")) { winget install -e --id Rustlang.Rustup }
winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
Write-Host "`nFeche e reabra o PowerShell, entre na pasta do projeto e rode: .\compilar.ps1" -ForegroundColor Yellow
