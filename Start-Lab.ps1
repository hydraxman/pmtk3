[CmdletBinding()]
param([switch]$NoServe)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$web = Join-Path $root 'web-lab'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 24 LTS, then rerun Start-Lab.ps1.'
}
$version = & node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') {
    throw "Node.js 24 LTS is required; found $version."
}
$python = Join-Path $root '.demo-runtime\python\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    & (Join-Path $root 'demo-lab\Setup-Runtimes.ps1') -Runtime Python
}
& $python (Join-Path $root 'demo-lab\run_demos.py') inventory
if ($LASTEXITCODE -ne 0) { throw 'Source inventory generation failed.' }
Push-Location $web
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Local npm dependency installation failed.' }
    }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Web laboratory build failed.' }
    & npm run reproduce -- --all
    if ($LASTEXITCODE -ne 0) { throw 'Visual reproduction validation failed.' }
    if (-not $NoServe) {
        Write-Host 'Open http://127.0.0.1:4173. Ctrl+C stops this attached local server.'
        & npm start
        if ($LASTEXITCODE -ne 0) { throw 'Local web server stopped with an error.' }
    }
}
finally { Pop-Location }
