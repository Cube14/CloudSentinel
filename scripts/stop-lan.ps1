$ErrorActionPreference = 'Stop'
$stateFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'data/lan-runtime/processes.json'
if (!(Test-Path $stateFile)) { return }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
for ($i = $state.processes.Count - 1; $i -ge 0; $i--) {
    $record = $state.processes[$i]
    $process = Get-Process -Id $record.id -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToFileTimeUtc().ToString() -eq $record.started) {
        Stop-Process -InputObject $process
    }
}
Remove-Item -LiteralPath $stateFile
