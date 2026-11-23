param([string]$Origin, [string]$RootCertificate)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if (!$Origin) {
    $stateFile = Join-Path $repo 'data/lan-runtime/processes.json'
    $Origin = (Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json).origin
}
if (!$RootCertificate) { $RootCertificate = Join-Path $repo 'data/lan-ca/pki/authorities/local/root.crt' }
$site = [Uri]$Origin
if ($site.Scheme -ne 'https' -or $site.GetLeftPart([UriPartial]::Authority) -cne $Origin) {
    throw 'Pass a canonical HTTPS origin.'
}
if (!(Test-Path -LiteralPath $RootCertificate -PathType Leaf)) { throw 'Provide the verified Caddy root certificate.' }
$node = (Get-Command node.exe -CommandType Application).Source
& $node (Join-Path $PSScriptRoot 'verify-lan.cjs') $Origin (Resolve-Path -LiteralPath $RootCertificate).Path
if ($LASTEXITCODE -ne 0) { throw 'LAN HTTPS verification failed.' }
