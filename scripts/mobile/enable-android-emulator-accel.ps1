# Enables Android emulator acceleration on Windows.
# Safe to launch from a normal shell: it relaunches itself elevated via UAC when needed.
$ErrorActionPreference = 'Continue'

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host 'Administrator privileges are required. Requesting UAC elevation...'
  $scriptPath = $PSCommandPath
  Start-Process powershell.exe -Verb RunAs -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', "`"$scriptPath`""
  )
  exit 0
}

Write-Host 'Running elevated. Enabling Windows emulator acceleration features...'
Write-Host 'Enabling Windows Hypervisor Platform...'
dism.exe /online /Enable-Feature /FeatureName:HypervisorPlatform /All /NoRestart

Write-Host 'Enabling Virtual Machine Platform...'
dism.exe /online /Enable-Feature /FeatureName:VirtualMachinePlatform /All /NoRestart

Write-Host 'Enabling hypervisor launch...'
bcdedit /set hypervisorlaunchtype auto

$installer = 'C:\Users\Arya\AppData\Local\Android\Sdk\extras\google\Android_Emulator_Hypervisor_Driver\silent_install.bat'
if (Test-Path $installer) {
  Write-Host "Installing Android Emulator Hypervisor Driver from $installer"
  Push-Location (Split-Path $installer)
  cmd.exe /c silent_install.bat
  Pop-Location
} else {
  Write-Warning "Android Emulator Hypervisor Driver installer not found: $installer"
}

Write-Host ''
Write-Host 'Done. Reboot Windows if DISM or the driver installer requested it.'
Write-Host 'After reboot, verify in Git Bash/Hermes with:'
Write-Host '  source ~/.bashrc'
Write-Host '  emulator -accel-check'
Write-Host '  npm run android:agent-test'
