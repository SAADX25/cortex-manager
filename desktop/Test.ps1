$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$applicationPath = & (Join-Path $PSScriptRoot 'Launch.ps1') -BuildOnly
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $applicationPath)) { throw 'Modern desktop executable was not built.' }
foreach ($asset in @('index.html','app.js','i18n.js','designer.js','arrange.js','styles.css','favicon.svg')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot ('web\' + $asset)))) { throw "Missing modern UI asset: $asset" }
}
& $nodePath --check (Join-Path $PSScriptRoot 'web\app.js')
if ($LASTEXITCODE -ne 0) { throw 'Modern UI JavaScript syntax check failed.' }
& $nodePath --check (Join-Path $PSScriptRoot 'web\i18n.js')
if ($LASTEXITCODE -ne 0) { throw 'Modern UI localization syntax check failed.' }
& $nodePath --check (Join-Path $PSScriptRoot 'web\arrange.js')
if ($LASTEXITCODE -ne 0) { throw 'Drag and drop JavaScript syntax check failed.' }
& $nodePath --check (Join-Path $PSScriptRoot 'web\designer.js')
if ($LASTEXITCODE -ne 0) { throw 'Design builder JavaScript syntax check failed.' }
& $nodePath --test (Join-Path $projectRoot 'test\desktop-server.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Modern desktop bridge tests failed.' }
Write-Output 'PASS: Modern Windows launcher compiled; local service, confirmation and credential-isolation tests passed.'
