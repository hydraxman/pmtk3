[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
if ($env:PAGES_TEST_URL) { throw 'Clear PAGES_TEST_URL so publishing validates the new local build, not an older deployed site.' }
$root = $PSScriptRoot
$repository = 'hydraxman/pmtk3'
$remote = "https://github.com/$repository.git"
function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE." }
}
Push-Location $root
try {
    $dirty = Invoke-Checked git @('status', '--porcelain')
    if ($dirty) { throw 'Commit all source changes before publishing immutable source links.' }
    $source = (Invoke-Checked git @('rev-parse', 'HEAD')).Trim()
    $publishedSource = Invoke-Checked git @('ls-remote', $remote, 'refs/heads/master')
    if (($publishedSource -split '\s+')[0] -ne $source) { throw 'Push this source revision to the fork master branch first.' }
    $account = (Invoke-Checked gh @('api', 'user', '--jq', '.login')).Trim()
    if ($account -ne 'hydraxman') { throw 'Sign in to the personal hydraxman account before publishing this fork.' }
    Push-Location (Join-Path $root 'web-lab')
    try {
        Invoke-Checked npm @('run', 'typecheck')
        Invoke-Checked npm @('run', 'pages:build')
        Invoke-Checked npm @('run', 'pages:test')
    } finally { Pop-Location }
    $output = Join-Path $root 'web-lab\dist\pages'
    $allowed = @('assets', 'data', 'images', 'index.html', 'catalog.json', 'publication.json', 'license.txt', '.nojekyll', 'robots.txt')
    $files = @(Get-ChildItem -LiteralPath $output -Force)
    if (@($files | Where-Object Name -NotIn $allowed).Count -or $files.Count -ne $allowed.Count) {
        throw 'Unexpected public build contents; inspect before publishing.'
    }
    $manifest = Get-Content -LiteralPath (Join-Path $output 'publication.json') -Raw | ConvertFrom-Json
    if ($manifest.sourceCommit -ne $source) { throw 'Published provenance does not match the committed source.' }
    $checkout = Join-Path $root ('.demo-runtime\pages-publish-' + [guid]::NewGuid().ToString('N'))
    $existing = Invoke-Checked git @('ls-remote', '--heads', $remote, 'gh-pages')
    if ($existing) {
        Invoke-Checked git @('clone', '--quiet', '--single-branch', '--branch', 'gh-pages', $remote, $checkout)
    } else {
        Invoke-Checked git @('init', '--quiet', '--initial-branch=gh-pages', $checkout)
        Invoke-Checked git @('-C', $checkout, 'remote', 'add', 'origin', $remote)
    }
    $name = (Invoke-Checked git @('var', 'GIT_AUTHOR_IDENT')) -replace ' <.*$', ''
    $email = (Invoke-Checked git @('var', 'GIT_AUTHOR_IDENT')) -replace '^.*<([^>]+)>.*$', '$1'
    Invoke-Checked git @('-C', $checkout, 'config', 'user.name', $name)
    Invoke-Checked git @('-C', $checkout, 'config', 'user.email', $email)
    # Remove only tracked publishing files in this newly owned, dedicated checkout.
    if ($existing) { Invoke-Checked git @('-C', $checkout, 'rm', '-r', '--quiet', '--ignore-unmatch', '.') }
    foreach ($file in $files) { Copy-Item -LiteralPath $file.FullName -Destination $checkout -Recurse -Force }
    Invoke-Checked git @('-C', $checkout, 'add', '--all')
    Invoke-Checked git @('-C', $checkout, 'commit', '--quiet', '-m', "Publish chapter gallery from $source", '-m',
        "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`nCopilot-Session: f12e2020-1371-416c-8456-143583b68cfc")
    Invoke-Checked git @('-C', $checkout, 'push', '--quiet', 'origin', 'HEAD:gh-pages')
    $hasPages = (Invoke-Checked gh @('api', "repos/$repository", '--jq', '.has_pages')).Trim()
    $method = if ($hasPages -eq 'true') { 'PUT' } else { 'POST' }
    Invoke-Checked gh @('api', '--method', $method, "repos/$repository/pages",
        '-f', 'build_type=legacy', '-f', 'source[branch]=gh-pages', '-f', 'source[path]=/', '--silent')
    $site = (Invoke-Checked gh @('api', "repos/$repository/pages", '--jq', '.html_url')).Trim()
    Write-Host "Waiting for GitHub Pages: $site"
    $live = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $public = Invoke-RestMethod -Uri ($site + "publication.json?revision=$source") -TimeoutSec 30
            if ($public.sourceCommit -eq $source -and $public.generatedAt -eq $manifest.generatedAt) { $live = $true; break }
        } catch {
            $status = [int]$_.Exception.Response.StatusCode
            if ($status -notin @(404, 429, 500, 502, 503, 504)) { throw }
        }
        if ($attempt % 6 -eq 0) { Write-Host 'Deployment has not reached the public edge yet.' }
        Start-Sleep -Seconds 10
    }
    if (-not $live) { throw 'Push succeeded but public deployment is unverified. Inspect the Pages build before reporting success.' }
    Write-Host "Published $($manifest.uniqueImages) computed images: $site"
    Write-Host "Publishing branch checkout retained for inspection: $checkout"
} finally { Pop-Location }
