$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$devEnvPath = Join-Path $projectRoot '.env.dev'

if (-not (Test-Path -LiteralPath $devEnvPath)) {
  throw 'Inicie primeiro o ambiente de criacao com scripts/start-dev.ps1.'
}

Push-Location $projectRoot
try {
  & docker compose --env-file .env.dev -f docker-compose.dev.yml -f docker-compose.dev-whatsapp.yml config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Configuracao de desenvolvimento invalida.' }
  & docker compose --env-file .env.dev -f docker-compose.dev.yml -f docker-compose.dev-whatsapp.yml up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel habilitar a rede de testes do WhatsApp.' }
  Write-Host 'Rede de testes habilitada. Conecte SOMENTE o numero de testes pelo QR Code em http://localhost:3001.'
} finally {
  Pop-Location
}
