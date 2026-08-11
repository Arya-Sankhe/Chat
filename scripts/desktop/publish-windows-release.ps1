param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$OutputDirectory = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { Join-Path $repoRoot "artifacts\windows-release" } else { $OutputDirectory }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
if ([IO.Path]::GetExtension($installer) -ne ".exe") { throw "The Windows release must be an .exe installer." }

$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or -not $signature.SignerCertificate) {
    throw "Refusing to publish an installer without a valid Authenticode signature."
}

$productVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($installer).ProductVersion
$version = ($productVersion -split "\+", 2)[0]
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw "Installer ProductVersion is not a publishable semantic version." }

$fileName = "klui-anything-$version.exe"
$destination = Join-Path $OutputDirectory $fileName
$sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToUpperInvariant()

if (Test-Path -LiteralPath $destination) {
    $existingHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($existingHash -ne $sha256) { throw "Version $version is already published with different bytes." }
} else {
    $temporaryInstaller = "$destination.$PID.tmp"
    try {
        Copy-Item -LiteralPath $installer -Destination $temporaryInstaller
        if ((Get-FileHash -LiteralPath $temporaryInstaller -Algorithm SHA256).Hash.ToUpperInvariant() -ne $sha256) {
            throw "The copied installer failed its SHA-256 check."
        }
        Move-Item -LiteralPath $temporaryInstaller -Destination $destination
    } finally {
        Remove-Item -LiteralPath $temporaryInstaller -Force -ErrorAction SilentlyContinue
    }
}

$metadata = [ordered]@{
    published = $true
    version = $version
    installerUrl = "/downloads/windows/$fileName"
    sha256 = $sha256
    signature = "Authenticode"
}
$temporaryMetadata = Join-Path $OutputDirectory "latest.json.tmp"
[IO.File]::WriteAllText($temporaryMetadata, ($metadata | ConvertTo-Json) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporaryMetadata -Destination (Join-Path $OutputDirectory "latest.json") -Force

Write-Output "Prepared Klui Anything $version for publication ($sha256)."
