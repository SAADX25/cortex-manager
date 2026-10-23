param([switch]$Legacy)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$applicationPath = & (Join-Path $PSScriptRoot 'Launch.ps1') -BuildOnly
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $applicationPath)) { throw 'Modern desktop executable was not built.' }
foreach ($asset in @('index.html','app.js','styles.css','favicon.svg')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot ('web\' + $asset)))) { throw "Missing modern UI asset: $asset" }
}
& $nodePath --check (Join-Path $PSScriptRoot 'web\app.js')
if ($LASTEXITCODE -ne 0) { throw 'Modern UI JavaScript syntax check failed.' }
& $nodePath --test (Join-Path $projectRoot 'test\desktop-server.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Modern desktop bridge tests failed.' }
Write-Output 'PASS: Modern Windows launcher compiled; local service, confirmation and credential-isolation tests passed.'
if (-not $Legacy) { return }
# The old renderer remains available only for regression tests. The normal
# launcher never builds or opens it.
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$legacyDirectory = Join-Path $projectRoot 'out\desktop'
New-Item -ItemType Directory -Path $legacyDirectory -Force | Out-Null
$applicationPath = Join-Path $legacyDirectory 'CortexManager-v5-test.exe'
& $compiler /nologo /target:winexe /optimize+ /utf8output /codepage:65001 "/out:$applicationPath" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll /reference:System.Core.dll (Join-Path $PSScriptRoot 'CortexManager.cs') (Join-Path $PSScriptRoot 'Dashboard.cs')
if ($LASTEXITCODE -ne 0) { throw 'Legacy test renderer compilation failed.' }
& $nodePath (Join-Path $PSScriptRoot 'mock-fixtures.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Could not create the network-blocking desktop test fixtures.' }
$testProcess = Start-Process -FilePath $applicationPath -ArgumentList @('--self-test', ('"' + $projectRoot + '"'), ('"' + $nodePath + '"')) -WindowStyle Hidden -PassThru
if (-not $testProcess.WaitForExit(30000)) {
    # This Process object refers only to the mock self-test we just launched.
    $testProcess.Kill()
    throw 'Desktop self-test timed out.'
}
if ($testProcess.ExitCode -ne 0) {
    $errorFile = Join-Path $projectRoot 'out\desktop\self-test-error.txt'
    if (Test-Path -LiteralPath $errorFile) { throw (Get-Content -LiteralPath $errorFile -Raw) }
    throw 'Desktop self-test failed.'
}
$result = Get-Content -LiteralPath (Join-Path $projectRoot 'out\desktop\self-test.json') -Raw | ConvertFrom-Json
if (-not $result.success) { throw 'Desktop self-test did not report success.' }
$requests = Get-Content -LiteralPath (Join-Path $projectRoot 'out\desktop\ui-mock-requests.jsonl') | ForEach-Object { $_ | ConvertFrom-Json }
if ($requests.Count -lt 10 -or ($requests | Where-Object { $_.method -ne 'GET' })) { throw 'Unexpected desktop worker requests.' }
Write-Output 'PASS: Arabic dashboard, server/channel/role views, Unicode edit review, Windows encryption, confirmation gating and clean shutdown. No real Discord network calls or writes.'
