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
    return 'Unavailable'
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
$firmwareVirtualization = [bool]$cpu.VirtualizationFirmwareEnabled
$slat = [bool]$cpu.SecondLevelAddressTranslationExtensions
$hypervisorPresent = [bool]$computer.HypervisorPresent

$vbox = Find-Executable @('VBoxManage.exe','VBoxManage')
$vmware = Find-Executable @('vmrun.exe','vmrun')
$qemu = Find-Executable @('qemu-system-x86_64.exe','qemu-system-x86_64')

$edition = [string]$os.WindowsEditionId
$hyperVEdition = $edition -match 'Professional|Enterprise|Education|Pro|Server'

$provider = 'none'
$readiness = 'blocked'
$nextAction = 'No supported isolated workspace provider was detected.'

if ($hyperVFeature -eq 'Enabled' -and $hyperVCmdlets -and $firmwareVirtualization -and $slat) {
  $provider = 'hyper-v'
  $readiness = 'ready'
  $nextAction = 'Hyper-V is ready for the MRD isolated workspace.'
} elseif ($hyperVEdition -and $firmwareVirtualization -and $slat) {
  $provider = 'hyper-v'
  $readiness = 'enable-required'
  $nextAction = 'Hardware and Windows edition support Hyper-V, but the Hyper-V feature/cmdlets are not fully enabled.'
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
    editionId = $edition
    build = [string]$os.OsBuildNumber
    architecture = [string]$os.OsArchitecture
  }
  hardware = [ordered]@{
    cpu = [string]$cpu.Name
    virtualizationFirmwareEnabled = $firmwareVirtualization
    slat = $slat
    hypervisorPresent = $hypervisorPresent
  }
  hyperV = [ordered]@{
    featureState = $hyperVFeature
    virtualMachinePlatformState = $vmPlatform
    hypervisorPlatformState = $hypervisorPlatform
    cmdletsAvailable = $hyperVCmdlets
    vmmsStatus = if ($vmms) { $vmms.Status.ToString() } else { 'NotInstalled' }
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
"Windows        : $($result.windows.productName) [$($result.windows.editionId)] build $($result.windows.build)"
"CPU            : $($result.hardware.cpu)"
"Firmware VT    : $($result.hardware.virtualizationFirmwareEnabled)"
"SLAT           : $($result.hardware.slat)"
"Hypervisor     : $($result.hardware.hypervisorPresent)"
''
"Hyper-V        : $($result.hyperV.featureState)"
"Hyper-V cmdlets: $($result.hyperV.cmdletsAvailable)"
"VMMS           : $($result.hyperV.vmmsStatus)"
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
