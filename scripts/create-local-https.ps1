param(
  [string]$ServerName = $env:COMPUTERNAME,
  [string]$ServerIp = ""
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectRoot "docker\https\generated"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
if (-not $ServerIp) {
  $ServerIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -match '^172\.(1[6-9]|2\d|3[01])\.' } | Select-Object -First 1 -ExpandProperty IPAddress)
}
if (-not $ServerIp) { throw "Não foi possível localizar o endereço IPv4 da rede local." }
$name = $ServerName.ToLowerInvariant()
$config = @"
[req]
distinguished_name=req_dn
req_extensions=req_ext
prompt=no
[req_dn]
CN=$name
[req_ext]
subjectAltName=@alt_names
[alt_names]
DNS.1=$ServerName
DNS.2=$name
DNS.3=$name.local
DNS.4=localhost
IP.1=$ServerIp
IP.2=127.0.0.1
"@
Set-Content -LiteralPath (Join-Path $outputDir "server.cnf") -Value $config -Encoding ascii
$mounted = "${outputDir}:/certs"
docker run --rm --entrypoint sh -v $mounted alpine/openssl -c "openssl genrsa -out /certs/ca.key 4096 && openssl req -x509 -new -nodes -key /certs/ca.key -sha256 -days 3650 -out /certs/atende-local-ca.crt -subj '/CN=Atende Local CA' && openssl genrsa -out /certs/server.key 2048 && openssl req -new -key /certs/server.key -out /certs/server.csr -config /certs/server.cnf && openssl x509 -req -in /certs/server.csr -CA /certs/atende-local-ca.crt -CAkey /certs/ca.key -CAcreateserial -out /certs/server.crt -days 825 -sha256 -extensions req_ext -extfile /certs/server.cnf"
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o certificado HTTPS." }
Copy-Item -LiteralPath (Join-Path $outputDir "atende-local-ca.crt") -Destination (Join-Path $projectRoot "public\atende-local-ca.crt") -Force
Write-Host "HTTPS preparado para https://$ServerName e https://$ServerIp"
Write-Host "Nos outros computadores, baixe http://$ServerName`:3000/atende-local-ca.crt e instale em Autoridades de Certificação Raiz Confiáveis."
