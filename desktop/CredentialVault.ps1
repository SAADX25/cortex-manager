param([Parameter(Mandatory=$true)][ValidateSet('protect','unprotect')][string]$Action)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security
    # Only base64 travels through stdin/stdout, avoiding console codepage loss.
    # Credentials are never passed as command-line arguments or written here.
    $vaultInput = [Console]::In.ReadToEnd().Trim()
    $vaultBytes = [Convert]::FromBase64String($vaultInput)
    $vaultEntropy = [Text.Encoding]::UTF8.GetBytes('CortexManager/v6/credentials')
    if ($Action -eq 'protect') {
        $vaultResult = [Security.Cryptography.ProtectedData]::Protect($vaultBytes,$vaultEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    } else {
        $vaultResult = [Security.Cryptography.ProtectedData]::Unprotect($vaultBytes,$vaultEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    }
    [Console]::Out.Write([Convert]::ToBase64String($vaultResult))
} catch {
    [Console]::Error.Write('Windows credential protection failed.')
    exit 1
}
