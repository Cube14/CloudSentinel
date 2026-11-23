param(
    [string]$LanIp,
    [string]$DnsName,
    [string]$CaddyPath = 'caddy.exe',
    [switch]$Plan
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $repo 'data/lan-runtime'
$stateFile = Join-Path $runtime 'processes.json'
$ipv4 = if ($LanIp) { Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanIp } else {
    $routes = @(Get-NetIPConfiguration | Where-Object IPv4DefaultGateway)
    if ($routes.Count -ne 1) { throw 'Pass -LanIp to select the intended adapter.' }
    $routes[0].IPv4Address
}
$ipv4 = @($ipv4)
if ($ipv4.Count -ne 1 -or $ipv4[0].IPAddress -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
    throw 'Select exactly one assigned RFC 1918 IPv4 address with -LanIp.'
}
$address = $ipv4[0]
$ip = $address.IPAddress
$profile = Get-NetConnectionProfile -InterfaceIndex $address.InterfaceIndex
$prefix = $address.PrefixLength
$privatePrefix = if ($ip.StartsWith('10.')) { 8 } elseif ($ip.StartsWith('172.')) { 12 } else { 16 }
if ($prefix -lt $privatePrefix) { throw 'The selected subnet extends beyond the private IPv4 range.' }
$bytes = [Net.IPAddress]::Parse($ip).GetAddressBytes()
for ($i = 0; $i -lt 4; $i++) {
    $bits = [Math]::Max(0, [Math]::Min(8, $prefix - 8 * $i))
    $bytes[$i] = $bytes[$i] -band (256 - [Math]::Pow(2, 8 - $bits))
}
$subnet = ($bytes -join '.') + '/' + $prefix
$siteHost = $ip
if ($DnsName) {
    if ($DnsName -cnotmatch '^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$') {
        throw 'Use a lowercase fully qualified LAN hostname.'
    }
    $resolved = @([Net.Dns]::GetHostAddresses($DnsName) | ForEach-Object IPAddressToString | Select-Object -Unique)
    if ($resolved.Count -ne 1 -or $resolved[0] -ne $ip) { throw 'The hostname must resolve only to the selected IPv4 address.' }
    $siteHost = $DnsName
}
$origin = "https://$siteHost"
$rootCert = Join-Path $repo 'data/lan-ca/pki/authorities/local/root.crt'
Write-Host "$origin on $($address.InterfaceAlias), $subnet, profile $($profile.NetworkCategory)"
Write-Host "Public root certificate (after start): $rootCert"
if ($Plan) { return }
if ($profile.NetworkCategory -ne 'Private') { throw 'Select a trusted Private network before starting LAN access.' }
if (Test-Path $stateFile) { throw 'Run scripts/stop-lan.ps1 before starting again.' }
$caddy = (Get-Command $CaddyPath -CommandType Application).Source
$node = (Get-Command node.exe -CommandType Application).Source
if (!(Test-Path (Join-Path $repo 'client/dist/index.html'))) { throw 'Run npm run build first.' }
if (Get-NetTCPConnection -State Listen -LocalPort 443,3153 -ErrorAction SilentlyContinue) {
    throw 'TCP 443 or 3153 is in use. Stop the existing service normally before starting LAN mode.'
}
foreach ($port in 4566,11434) {
    $external = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
        Where-Object LocalAddress -notin @('127.0.0.1','::1')
    if ($external) { throw "Bind the service on port $port to loopback before starting LAN access." }
}
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$token = (& $node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
if ($LASTEXITCODE -ne 0 -or $token -cnotmatch '^[a-f0-9]{64}$') { throw 'Could not generate proxy token.' }
$settings = @{
    PORT = '3153'; LAN_PROXY = '1'; LAN_HTTPS_ORIGIN = $origin; LAN_PROXY_TOKEN = $token
    CS_CADDY_ORIGIN = $origin; CS_CADDY_HOST = $siteHost; CS_CADDY_PORT = '443'; CS_CADDY_BIND = $ip; CS_CADDY_SUBNET = $subnet
    CS_CADDY_DATA = 'data/lan-ca'; CS_NODE_PORT = '3153'
}
$previous = @{}
$started = @()
Push-Location $repo
try {
    foreach ($key in $settings.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
    }
    & $caddy validate --config deploy/Caddyfile --adapter caddyfile
    if ($LASTEXITCODE -ne 0) { throw 'Caddy configuration failed validation.' }
    $started += Start-Process -FilePath $node -ArgumentList '--env-file-if-exists=.env','server/server.js' -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime/node.log" -RedirectStandardError "$runtime/node-error.log"
    $started += Start-Process -FilePath $caddy -ArgumentList 'run','--config','deploy/Caddyfile','--adapter','caddyfile' -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime/caddy.log" -RedirectStandardError "$runtime/caddy-error.log"
    $deadline = (Get-Date).AddSeconds(15)
    do {
        foreach ($process in $started) {
            if ($process.HasExited) { throw "A service exited. See $runtime logs." }
        }
        $nodeReady = Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 3153 -OwningProcess $started[0].Id -ErrorAction SilentlyContinue
        $caddyReady = Get-NetTCPConnection -State Listen -LocalAddress $ip -LocalPort 443 -OwningProcess $started[1].Id -ErrorAction SilentlyContinue
        if ($nodeReady -and $caddyReady -and (Test-Path $rootCert)) { break }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    if (!$nodeReady -or !$caddyReady -or !(Test-Path $rootCert)) { throw "Startup did not complete. See $runtime logs." }
    $records = @($started | ForEach-Object { @{ id = $_.Id; started = $_.StartTime.ToFileTimeUtc().ToString() } })
    @{ origin = $origin; processes = $records } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8
    Write-Host "CloudSentinel is listening at $origin. Run scripts/test-lan.ps1 to verify TLS and proxy routing."
} catch {
    foreach ($process in $started) { if (!$process.HasExited) { Stop-Process -InputObject $process } }
    throw
} finally {
    foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    Pop-Location
}
