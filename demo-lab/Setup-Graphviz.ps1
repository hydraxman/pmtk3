[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = '16.1.0'
$expectedHash = '733e49626c492242eb8dca30ea627b6ead20710e207998c7933b4909d92d6abc'
$asset = "windows_10_cmake_Release_Graphviz-$version-win64.zip"
$url = "https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/$version/$asset"
$runtime = Join-Path $root '.demo-runtime\graphviz'
$manifest = Join-Path $runtime 'runtime.json'
$cache = Join-Path $root ".demo-runtime\downloads\graphviz-$version-win64.zip"
$target = Join-Path $runtime $version
New-Item -ItemType Directory -Force -Path $runtime, (Split-Path -Parent $cache) | Out-Null

if (Test-Path -LiteralPath $manifest) {
    $metadata = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    if ($metadata.version -ne $version -or $metadata.archive_sha256 -ne $expectedHash) {
        throw 'An existing Graphviz runtime uses a different pinned release; refusing to overwrite it.'
    }
    $prefix = [IO.Path]::GetFullPath($runtime) + [IO.Path]::DirectorySeparatorChar
    foreach ($file in $metadata.verified_files) {
        $path = [IO.Path]::GetFullPath((Join-Path $runtime $file.relative_path))
        if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $path) -or
            (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) {
            throw "Graphviz runtime file is missing or modified; no files were overwritten: $path"
        }
    }
} else {
    if (Test-Path -LiteralPath $target) {
        throw "Graphviz target already exists without its verified manifest: $target"
    }
    if (-not (Test-Path -LiteralPath $cache)) {
        $partial = "$cache.partial-$([guid]::NewGuid().ToString('N'))"
        & curl.exe --fail --location --retry 3 --silent --show-error --output $partial $url
        if ($LASTEXITCODE -ne 0) { throw "Graphviz archive download failed: $url" }
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $expectedHash) {
            throw "Graphviz archive failed the publisher-published SHA-256 check: $partial"
        }
        Move-Item -LiteralPath $partial -Destination $cache
    }
    if ((Get-FileHash -LiteralPath $cache -Algorithm SHA256).Hash -ne $expectedHash) {
        throw "Cached Graphviz archive does not match the pinned publisher checksum: $cache"
    }
    $stage = Join-Path $runtime ".stage-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $stage | Out-Null
    $prefix = [IO.Path]::GetFullPath($stage) + [IO.Path]::DirectorySeparatorChar
    $zip = [IO.Compression.ZipFile]::OpenRead($cache)
    try {
        foreach ($entry in $zip.Entries) {
            $relative = $entry.FullName.Replace('/', [IO.Path]::DirectorySeparatorChar)
            $destination = [IO.Path]::GetFullPath((Join-Path $stage $relative))
            if (-not $destination.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Graphviz archive entry escapes its extraction directory: $($entry.FullName)"
            }
        }
    } finally {
        $zip.Dispose()
    }
    Expand-Archive -LiteralPath $cache -DestinationPath $stage
    $dots = @(Get-ChildItem -LiteralPath $stage -Recurse -File -Filter 'dot.exe')
    $plugins = @(Get-ChildItem -LiteralPath $stage -Recurse -File -Filter 'gvplugin_core.dll')
    if ($dots.Count -ne 1 -or $plugins.Count -ne 1) {
        throw "Graphviz archive has a missing or ambiguous executable/plugin layout: $stage"
    }
    $dotRelative = [IO.Path]::GetRelativePath($stage, $dots[0].FullName)
    $pluginRelative = [IO.Path]::GetRelativePath($stage, $plugins[0].DirectoryName)
    Move-Item -LiteralPath $stage -Destination $target
    $dot = Join-Path $target $dotRelative
    $pluginDirectory = Join-Path $target $pluginRelative
    $oldPath = $env:PATH
    $oldPlugin = $env:GVBINDIR
    try {
        $env:PATH = "$(Split-Path -Parent $dot);$oldPath"
        $env:GVBINDIR = $pluginDirectory
        & $dot -c
        if ($LASTEXITCODE -ne 0) { throw 'Graphviz local plugin registration failed.' }
        $versionOutput = (& $dot -V 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '\b16\.1\.0\b') {
            throw "Graphviz version verification failed: $versionOutput"
        }
        $probe = Join-Path $root 'demo-results\graphviz-smoke'
        New-Item -ItemType Directory -Force -Path $probe | Out-Null
        $inputFile = Join-Path $probe 'three-nodes.dot'
        $outputFile = Join-Path $probe 'three-nodes.png'
        [IO.File]::WriteAllText($inputFile, 'digraph G { a -> b; b -> c; a -> c; }')
        & $dot -Tpng $inputFile -o $outputFile
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputFile)) {
            throw 'Graphviz did not produce its real PNG smoke artifact.'
        }
        $signature = [IO.File]::ReadAllBytes($outputFile)
        if ($signature.Length -lt 8 -or [Convert]::ToHexString($signature[0..7]) -ne '89504E470D0A1A0A') {
            throw 'Graphviz smoke artifact is not a valid PNG.'
        }
    } finally {
        $env:PATH = $oldPath
        $env:GVBINDIR = $oldPlugin
    }
    $binaries = @(Get-ChildItem -LiteralPath $target -Recurse -File |
        Where-Object { $_.Extension -in @('.exe', '.dll') } |
        ForEach-Object {
            @{ relative_path = [IO.Path]::GetRelativePath($runtime, $_.FullName)
               sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
        })
    $licenses = @(Get-ChildItem -LiteralPath $target -Recurse -File |
        Where-Object { $_.Name -match '^(LICENSE|COPYING|COPYRIGHT)' } |
        ForEach-Object { [IO.Path]::GetRelativePath($runtime, $_.FullName) })
    $metadata = [pscustomobject]@{
        schema_version = 1
        version = $version
        archive_url = $url
        archive_sha256 = $expectedHash
        publisher_checksum_url = "$url.sha256"
        dot_relative = [IO.Path]::GetRelativePath($runtime, $dot)
        plugin_directory_relative = [IO.Path]::GetRelativePath($runtime, $pluginDirectory)
        dot_sha256 = (Get-FileHash -LiteralPath $dot -Algorithm SHA256).Hash.ToLowerInvariant()
        version_output = $versionOutput
        verified_files = $binaries
        license_files = $licenses
    }
    [IO.File]::WriteAllText("$manifest.partial", ($metadata | ConvertTo-Json -Depth 8))
    Move-Item -LiteralPath "$manifest.partial" -Destination $manifest
}
$licenseHash = '0becf16567beb77fa252b7664631dd177c8f9a1889e48995b45379c7130e5303'
$licenseUrl = 'https://gitlab.com/api/v4/projects/4207231/repository/files/COPYING/raw?ref=e41c710710be080ad37af1b51c6e2f8beffa9ee5'
$licenseRelative = "COPYING-$version"
$licenseFile = Join-Path $runtime $licenseRelative
if (-not (Test-Path -LiteralPath $licenseFile)) {
    & curl.exe --fail --location --retry 3 --silent --show-error --output "$licenseFile.partial" $licenseUrl
    if ($LASTEXITCODE -ne 0) { throw 'Graphviz source license download failed.' }
    if ((Get-FileHash -LiteralPath "$licenseFile.partial" -Algorithm SHA256).Hash -ne $licenseHash) {
        throw 'Graphviz source license does not match its pinned official hash.'
    }
    Move-Item -LiteralPath "$licenseFile.partial" -Destination $licenseFile
}
if ((Get-FileHash -LiteralPath $licenseFile -Algorithm SHA256).Hash -ne $licenseHash) {
    throw "Graphviz source license is modified; no files were overwritten: $licenseFile"
}
$metadata.license_files = @(@($metadata.license_files) + $licenseRelative | Select-Object -Unique)
$metadata | Add-Member -NotePropertyName primary_license -NotePropertyValue 'EPL-2.0' -Force
$metadata | Add-Member -NotePropertyName license_source_url -NotePropertyValue $licenseUrl -Force
$metadata | Add-Member -NotePropertyName license_sha256 -NotePropertyValue $licenseHash -Force
if (-not @($metadata.verified_files | Where-Object relative_path -eq $licenseRelative).Count) {
    $metadata.verified_files = @($metadata.verified_files) + @{
        relative_path = $licenseRelative
        sha256 = $licenseHash
    }
}
[IO.File]::WriteAllText("$manifest.partial", ($metadata | ConvertTo-Json -Depth 8))
[IO.File]::Move("$manifest.partial", $manifest, $true)
$results = Join-Path $root 'demo-results'
New-Item -ItemType Directory -Force -Path $results | Out-Null
Copy-Item -LiteralPath $manifest -Destination (Join-Path $results 'graphviz-runtime.json')
Write-Output "Verified isolated Graphviz $version; provenance: $manifest"
