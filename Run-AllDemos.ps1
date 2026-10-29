[CmdletBinding()]
param(
    [ValidateRange(1, 3)]
    [int]$Jobs = 3,
    [ValidateRange(5, 3600)]
    [int]$TimeoutSeconds = 120,
    [ValidateSet('Qt', 'Console')]
    [string]$Engine = 'Qt',
    [switch]$RetryFailed
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$python = Join-Path $root '.demo-runtime\python\python.exe'
$octaveRoot = Join-Path $root '.demo-runtime\octave'
if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath $octaveRoot)) {
    & (Join-Path $root 'demo-lab\Setup-Runtimes.ps1')
}
$binary = if ($Engine -eq 'Qt') { 'octave-gui.exe' } else { 'octave-cli.exe' }
$toolkit = if ($Engine -eq 'Qt') { 'qt' } else { 'gnuplot' }
$octave = Get-ChildItem -LiteralPath $octaveRoot -File -Recurse -Filter $binary | Select-Object -First 1
if (-not $octave) { throw 'A verified portable Octave runtime must be installed first.' }
& (Join-Path $root 'demo-lab\Setup-Graphviz.ps1')
$support = Join-Path $root 'pmtksupportCopy\packages'
if (-not (Test-Path -LiteralPath (Join-Path $support 'pmtkSupportRoot.m'))) {
    & git clone --depth 1 https://github.com/probml/pmtksupport.git $support
    if ($LASTEXITCODE -ne 0) { throw 'Could not clone official PMTK support packages.' }
}
$dataSource = Join-Path $root '.demo-runtime\data-source'
if (-not (Test-Path -LiteralPath (Join-Path $dataSource '.git'))) {
    & git clone --filter=blob:none --sparse --depth 1 https://github.com/probml/pmtkdata.git $dataSource
    if ($LASTEXITCODE -ne 0) { throw 'Could not clone the official dataset index.' }
}
& $python (Join-Path $root 'data-tools\audit_data.py') --recover --upstream $dataSource --dataset yeastStress --dataset yeastCellCycle
if ($LASTEXITCODE -ne 0) { throw 'Dataset audit or recovery failed.' }
& $python (Join-Path $root 'data-tools\restore_legacy.py')
if ($LASTEXITCODE -ne 0) { throw 'Historical factor-analysis support recovery failed.' }
& $python (Join-Path $root 'data-tools\patch_support.py')
if ($LASTEXITCODE -ne 0) { throw 'Optional native-extension compatibility patch failed.' }
$arguments = @(
    (Join-Path $root 'demo-lab\run_demos.py'), 'run',
    '--octave', $octave.FullName,
    '--jobs', $Jobs,
    '--timeout', $TimeoutSeconds,
    '--graphics-toolkit', $toolkit,
    '--memory-limit-mib', 6144
)
if ($RetryFailed) { $arguments += '--retry-failed' }
& $python @arguments
exit $LASTEXITCODE
