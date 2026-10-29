[CmdletBinding()]
param(
    [ValidateSet('Python', 'Octave', 'All')]
    [string]$Runtime = 'All'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $root '.demo-runtime'
$cache = Join-Path $runtimeRoot 'downloads'
New-Item -ItemType Directory -Path $cache -Force | Out-Null

function Get-Archive {
    param([string]$Url, [string]$Destination)
    if (-not (Test-Path -LiteralPath $Destination)) {
        $partial = "$Destination.partial"
        & curl.exe --fail --location --retry 3 --continue-at - --silent --show-error --output $partial $Url
        if ($LASTEXITCODE -ne 0) {
            throw "Download failed: $Url"
        }
        Move-Item -LiteralPath $partial -Destination $Destination
    }
}

if ($Runtime -in @('Python', 'All')) {
    $version = '3.15.2'
    $archive = Join-Path $cache "python-$version-embed-amd64.zip"
    Get-Archive "https://www.python.org/ftp/python/$version/python-$version-embed-amd64.zip" $archive
    $expectedHash = 'd012f3aa29cf07436dae8aea1fec0fd195c2612a0b059b1f915ae0afb9ad1f62'
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) {
        throw 'Python archive does not match the SHA-256 published on python.org.'
    }
    $destination = Join-Path $runtimeRoot 'python'
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'python.exe'))) {
        Expand-Archive -LiteralPath $archive -DestinationPath $destination
    }
    $modulePath = Join-Path $root 'demo-lab'
    $pathFile = Join-Path $destination 'python315._pth'
    $configuredPaths = [IO.File]::ReadAllLines($pathFile)
    if ($modulePath -notin $configuredPaths) {
        [IO.File]::AppendAllText($pathFile, "`n$modulePath`n", [Text.UTF8Encoding]::new($false))
    }
    & (Join-Path $destination 'python.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'Python validation failed.' }
}

if ($Runtime -in @('Octave', 'All')) {
    $version = '11.3.0'
    $name = "octave-$version-w64.zip"
    $archive = Join-Path $cache $name
    $url = "https://ftp.gnu.org/gnu/octave/windows/$name"
    Get-Archive $url $archive
    Get-Archive "$url.sig" "$archive.sig"
    $gpg = Get-Command gpg -ErrorAction SilentlyContinue
    $gpgPath = if ($gpg) { $gpg.Source } else { 'C:\Program Files\Git\usr\bin\gpg.exe' }
    if (-not (Test-Path -LiteralPath $gpgPath)) {
        throw 'GnuPG is required to verify the GNU Octave archive before extraction.'
    }
    $keyring = Join-Path $cache 'gnupg'
    New-Item -ItemType Directory -Path $keyring -Force | Out-Null
    Push-Location $cache
    try {
        $fingerprint = 'DBD9C84E39FE1AAE99F04446B05F05B75D36644B'
        & $gpgPath --homedir gnupg --batch --list-keys $fingerprint *> $null
        if ($LASTEXITCODE -ne 0) {
            & $gpgPath --homedir gnupg --batch --keyserver hkps://keyserver.ubuntu.com --recv-keys $fingerprint
            if ($LASTEXITCODE -ne 0) { throw 'Could not obtain the Octave release signing key.' }
        }
        $verification = & $gpgPath --homedir gnupg --batch --status-fd 1 --verify "$name.sig" $name
        if ($LASTEXITCODE -ne 0 -or -not ($verification -match "VALIDSIG $fingerprint ")) {
            throw 'Octave signature verification did not match the pinned GNU release signer.'
        }
    }
    finally {
        Pop-Location
    }
    $destination = Join-Path $runtimeRoot 'octave'
    $expectedCli = Join-Path $destination "octave-$version-w64\mingw64\bin\octave-cli.exe"
    if (-not (Test-Path -LiteralPath $expectedCli)) {
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        & tar.exe -xf $archive -C $destination
        if ($LASTEXITCODE -ne 0) { throw 'Octave archive extraction failed.' }
    }
    $cli = Get-ChildItem -LiteralPath $destination -Recurse -File -Filter 'octave-cli.exe' | Select-Object -First 1
    if (-not $cli) { throw 'Extracted Octave does not contain octave-cli.exe.' }
    & $cli.FullName --version
    if ($LASTEXITCODE -ne 0) { throw 'Octave validation failed.' }
}
