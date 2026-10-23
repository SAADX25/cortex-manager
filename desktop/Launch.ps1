param([switch]$BuildOnly, [switch]$Demo)
$ErrorActionPreference = 'Stop'
try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    $nodePath = $nodeCommand.Source
    $nodeVersion = & $nodePath -p 'process.versions.node'
    if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.4.0') { throw 'Node.js 22.4 or newer is required. Install Node.js, then reopen the launcher.' }
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
    if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is missing. Install .NET Framework 4.8.' }
    $outputDirectory = Join-Path $projectRoot 'out\desktop-modern'
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $applicationPath = Join-Path $projectRoot 'CortexManager.exe'
    $sourcePaths = @(Join-Path $PSScriptRoot 'ModernLauncher.cs')
    $iconPath = Join-Path $outputDirectory 'CortexManager.ico'
    & (Join-Path $PSScriptRoot 'Create-Icon.ps1') -OutputPath $iconPath
    $latestSource = ($sourcePaths | ForEach-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } | Sort-Object -Descending | Select-Object -First 1)
    if (-not (Test-Path -LiteralPath $applicationPath) -or $latestSource -gt (Get-Item -LiteralPath $applicationPath).LastWriteTimeUtc) {
        $compilerOutput = & $compiler /nologo /target:winexe /optimize+ /utf8output /codepage:65001 "/out:$applicationPath" "/win32icon:$iconPath" /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.Core.dll $sourcePaths 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($compilerOutput -join [Environment]::NewLine) }
    }
    if ($BuildOnly) { Write-Output $applicationPath; return }
    if ($Demo) { Start-Process -FilePath $applicationPath -ArgumentList '--demo' }
    else { Start-Process -FilePath $applicationPath }
} catch {
    if ($BuildOnly) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Cortex Manager - Startup error', 'OK', 'Error') | Out-Null
    exit 1
}
