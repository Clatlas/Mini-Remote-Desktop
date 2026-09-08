param(
  [switch]$Json
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function Get-FeatureState([string]$Name) {
  try {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName $Name -ErrorAction Stop
    return $feature.State.ToString()
  } catch {
    # Get-WindowsOptionalFeature commonly requires elevation even when the
    # feature is installed. Do not confuse a non-elevated query failure with
    # an unavailable Windows feature.
    return 'Unknown (elevation required)'
  }
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Find-Executable([string[]]$Names) {
  foreach ($name in $Names) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

$os = Get-ComputerInfo -Property WindowsProductName,WindowsEditionId,OsBuildNumber,OsArchitecture
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$computer = Get-CimInstance Win32_ComputerSystem
$vmms = Get-Service vmms -ErrorAction SilentlyContinue

$hyperVFeature = Get-FeatureState 'Microsoft-Hyper-V-All'
$vmPlatform = Get-FeatureState 'VirtualMachinePlatform'
$hypervisorPlatform = Get-FeatureState 'HypervisorPlatform'
$hyperVCmdlets = Test-Command 'Get-VM'
$firmwareVirtualizationRaw = [bool]$cpu.VirtualizationFirmwareEnabled
$slatRaw = [bool]$cpu.SecondLevelAddressTranslationExtensions
$hypervisorPresent = [bool]$computer.HypervisorPresent
$vmmsRunning = [bool]($vmms -and $vmms.Status -eq 'Running')

# When the Microsoft hypervisor is already loaded, some Win32_Processor
# virtualization capability fields can report False because the hypervisor
# owns those CPU capabilities. A running Hyper-V hypervisor + VMMS is stronger
# evidence than those raw WMI flags.
$hyperVOperational = [bool]($hypervisorPresent -and $hyperVCmdlets -and $vmmsRunning)
$firmwareVirtualization = [bool]($firmwareVirtualizationRaw -or $hyperVOperational)
$slat = [bool]($slatRaw -or $hyperVOperational)

$hyperVManagementAccessible = $false
$hyperVManagementError = $null
if ($hyperVCmdlets) {
  try {
    Get-VM -ErrorAction Stop | Out-Null
    $hyperVManagementAccessible = $true
  } catch {
    $hyperVManagementError = $_.Exception.Message
  }
}

$vbox = Find-Executable @('VBoxManage.exe','VBoxManage')
$vmware = Find-Executable @('vmrun.exe','vmrun')
$qemu = Find-Executable @('qemu-system-x86_64.exe','qemu-system-x86_64')

$edition = [string]$os.WindowsEditionId
$hyperVEdition = $edition -match 'Professional|Enterprise|Education|Pro|Server'
$buildNumber = 0
[void][int]::TryParse([string]$os.OsBuildNumber, [ref]$buildNumber)
$windowsFamily = if ($buildNumber -ge 22000) { 'Windows 11' } else { [string]$os.WindowsProductName }
$displayEdition = if ($edition -match 'Professional|Pro') { 'Pro' } elseif ($edition) { $edition } else { '' }
$displayName = ($windowsFamily + $(if ($displayEdition) { " $displayEdition" } else { '' })).Trim()

$provider = 'none'
$readiness = 'blocked'
$nextAction = 'No supported isolated workspace provider was detected.'

if ($hyperVOperational -and $hyperVManagementAccessible) {
  $provider = 'hyper-v'
  $readiness = 'ready'
  $nextAction = 'Hyper-V is operational and MRD has management access. The isolated workspace can be provisioned.'
} elseif ($hyperVOperational) {
  $provider = 'hyper-v'
  $readiness = 'elevation-required'
  $nextAction = 'Hyper-V is operational, but the current MRD account cannot manage VMs without elevation or Hyper-V Administrators membership.'
} elseif ($hyperVFeature -eq 'Enabled' -and $hyperVCmdlets -and $firmwareVirtualization -and $slat) {
  $provider = 'hyper-v'
  $readiness = 'start-required'
  $nextAction = 'Hyper-V is installed, but the hypervisor/VMMS stack is not currently operational.'
} elseif ($hyperVEdition -and $firmwareVirtualization -and $slat) {
  $provider = 'hyper-v'
  $readiness = 'enable-required'
  $nextAction = 'Hardware and Windows edition support Hyper-V, but Hyper-V must be enabled or repaired before MRD provisioning.'
} elseif ($vmware) {
  $provider = 'vmware'
  $readiness = 'provider-detected'
  $nextAction = 'VMware tooling is installed and can be evaluated as the MRD workspace backend.'
} elseif ($vbox) {
  $provider = 'virtualbox'
  $readiness = 'provider-detected'
  $nextAction = 'VirtualBox tooling is installed and can be evaluated as the MRD workspace backend.'
} elseif ($qemu -and ($hypervisorPresent -or $hypervisorPlatform -eq 'Enabled')) {
  $provider = 'qemu-whpx'
  $readiness = 'provider-detected'
  $nextAction = 'QEMU and a Windows hypervisor interface are present and can be evaluated as the MRD workspace backend.'
} elseif ($firmwareVirtualization -and $slat) {
  $provider = 'external-vm'
  $readiness = 'provider-required'
  $nextAction = 'Hardware virtualization is ready, but MRD needs a supported VM provider installed or enabled.'
}

$result = [ordered]@{
  architecture = 'isolated-workspace-v1'
  windows = [ordered]@{
    productName = [string]$os.WindowsProductName
    displayName = $displayName
    family = $windowsFamily
    editionId = $edition
    build = [string]$os.OsBuildNumber
    architecture = [string]$os.OsArchitecture
  }
  hardware = [ordered]@{
    cpu = [string]$cpu.Name
    virtualizationFirmwareEnabled = $firmwareVirtualization
    virtualizationFirmwareRaw = $firmwareVirtualizationRaw
    slat = $slat
    slatRaw = $slatRaw
    hypervisorPresent = $hypervisorPresent
  }
  hyperV = [ordered]@{
    featureState = $hyperVFeature
    virtualMachinePlatformState = $vmPlatform
    hypervisorPlatformState = $hypervisorPlatform
    cmdletsAvailable = $hyperVCmdlets
    vmmsStatus = if ($vmms) { $vmms.Status.ToString() } else { 'NotInstalled' }
    operational = $hyperVOperational
    managementAccessible = $hyperVManagementAccessible
    managementError = $hyperVManagementError
    editionEligible = $hyperVEdition
  }
  alternateProviders = [ordered]@{
    vmware = $vmware
    virtualBox = $vbox
    qemu = $qemu
  }
  recommendation = [ordered]@{
    provider = $provider
    readiness = $readiness
    nextAction = $nextAction
  }
}

if ($Json) {
  $result | ConvertTo-Json -Depth 6 -Compress
  exit 0
}

'=== MRD ISOLATED WORKSPACE CAPABILITY ==='
"Windows        : $($result.windows.displayName) [$($result.windows.editionId)] build $($result.windows.build)"
"CPU            : $($result.hardware.cpu)"
"Firmware VT    : $($result.hardware.virtualizationFirmwareEnabled) (raw: $($result.hardware.virtualizationFirmwareRaw))"
"SLAT           : $($result.hardware.slat) (raw: $($result.hardware.slatRaw))"
"Hypervisor     : $($result.hardware.hypervisorPresent)"
''
"Hyper-V        : $($result.hyperV.featureState)"
"Hyper-V cmdlets: $($result.hyperV.cmdletsAvailable)"
"VMMS           : $($result.hyperV.vmmsStatus)"
"HV operational : $($result.hyperV.operational)"
"HV management  : $($result.hyperV.managementAccessible)"
"VM Platform    : $($result.hyperV.virtualMachinePlatformState)"
"HV Platform    : $($result.hyperV.hypervisorPlatformState)"
''
"VMware         : $(if($vmware){$vmware}else{'Not detected'})"
"VirtualBox     : $(if($vbox){$vbox}else{'Not detected'})"
"QEMU           : $(if($qemu){$qemu}else{'Not detected'})"
''
"MRD provider   : $provider"
"Readiness      : $readiness"
"Next           : $nextAction"
if ($hyperVManagementError) { "HV access note : $hyperVManagementError" }
