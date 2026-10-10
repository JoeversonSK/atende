$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$devEnvPath = Join-Path $projectRoot '.env.dev'

function New-DevSecret {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

if (-not (Test-Path -LiteralPath $devEnvPath)) {
  $settings = @(
    '# Segredos exclusivos do ambiente de criação. Não copiar da produção.'
    "DEV_POSTGRES_PASSWORD=$(New-DevSecret)"
    "DEV_APP_SESSION_SECRET=$(New-DevSecret)"
    "DEV_OPENWA_MASTER_KEY=$(New-DevSecret)"
  )
  [System.IO.File]::WriteAllLines($devEnvPath, $settings, [System.Text.UTF8Encoding]::new($false))
  Write-Host 'Configuração local de desenvolvimento criada em .env.dev.'
}

Push-Location $projectRoot
try {
  & docker compose --env-file .env.dev -f docker-compose.dev.yml up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível iniciar o ambiente de criação.' }
  & docker compose --env-file .env.dev -f docker-compose.dev.yml ps
  if ($LASTEXITCODE -ne 0) { throw 'Não foi possível verificar o ambiente de criação.' }
  Write-Host 'Ambiente de criação: http://localhost:3001'
} finally {
  Pop-Location
}
