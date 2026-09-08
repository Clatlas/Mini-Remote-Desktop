import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class WorkspaceManager {
  constructor(root) {
    this.root = root;
    this.lastProbe = null;
    this.lastError = null;
    this.lastProbeAt = 0;
  }

  get status() {
    const recommendation = this.lastProbe?.recommendation || {};
    return {
      architecture: 'isolated-workspace-v1',
      phase: 'capability-probe',
      provider: recommendation.provider || 'unknown',
      readiness: recommendation.readiness || 'unknown',
      nextAction: recommendation.nextAction || 'Run the workspace capability probe.',
      probedAt: this.lastProbeAt || null,
      capabilities: this.lastProbe,
      lastError: this.lastError,
      liveWorkspaceProvisioned: false,
      privacyContract: {
        lockedHostSupported: true,
        unlockedHostSupported: true,
        secretGuarantee: 'MRD workspace activity is isolated from the physical console.',
        notSecretGuarantee: 'No local-visibility guarantee is required.'
      }
    };
  }

  async probe({ force = false } = {}) {
    if (process.platform !== 'win32') {
      this.lastError = 'MRD isolated workspace probing is Windows-only.';
      return this.status;
    }

    const now = Date.now();
    if (!force && this.lastProbe && now - this.lastProbeAt < 30000) return this.status;

    const script = path.join(this.root, 'scripts', 'workspace-capability.ps1');
    try {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script, '-Json'
      ], {
        cwd: this.root,
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 512 * 1024
      });

      const text = String(stdout || '').trim();
      if (!text) throw new Error('Workspace capability probe returned no data.');
      this.lastProbe = JSON.parse(text.split(/\r?\n/).filter(Boolean).at(-1));
      this.lastProbeAt = Date.now();
      this.lastError = null;
    } catch (error) {
      this.lastError = String(error.stderr || error.message || error).trim();
    }

    return this.status;
  }

  async getDiagnostics() {
    const status = await this.probe({ force: true });
    return formatWorkspaceDiagnostics(status);
  }
}

function formatWorkspaceDiagnostics(status) {
  const c = status.capabilities || {};
  const windows = c.windows || {};
  const hardware = c.hardware || {};
  const hyperV = c.hyperV || {};
  const alternate = c.alternateProviders || {};
  const recommendation = c.recommendation || {};

  const displayName = windows.displayName || windows.productName || 'Unknown';
  const firmwareEffective = hardware.virtualizationFirmwareEnabled;
  const firmwareRaw = hardware.virtualizationFirmwareRaw;
  const slatEffective = hardware.slat;
  const slatRaw = hardware.slatRaw;

  return [
    '=== MRD ISOLATED WORKSPACE ===',
    `Architecture : ${status.architecture}`,
    `Phase        : ${status.phase}`,
    `Provider     : ${status.provider}`,
    `Readiness    : ${status.readiness}`,
    '',
    `Windows      : ${displayName} [${windows.editionId || 'Unknown'}] build ${windows.build || '?'}`,
    `CPU          : ${hardware.cpu || 'Unknown'}`,
    `Firmware VT  : ${String(firmwareEffective ?? 'Unknown')}${firmwareRaw != null ? ` (raw: ${firmwareRaw})` : ''}`,
    `SLAT         : ${String(slatEffective ?? 'Unknown')}${slatRaw != null ? ` (raw: ${slatRaw})` : ''}`,
    `Hypervisor   : ${String(hardware.hypervisorPresent ?? 'Unknown')}`,
    '',
    `Hyper-V      : ${hyperV.featureState || 'Unknown'}`,
    `HV cmdlets   : ${String(hyperV.cmdletsAvailable ?? 'Unknown')}`,
    `VMMS         : ${hyperV.vmmsStatus || 'Unknown'}`,
    `HV operational: ${String(hyperV.operational ?? 'Unknown')}`,
    `HV management : ${String(hyperV.managementAccessible ?? 'Unknown')}`,
    `VM Platform  : ${hyperV.virtualMachinePlatformState || 'Unknown'}`,
    `HV Platform  : ${hyperV.hypervisorPlatformState || 'Unknown'}`,
    '',
    `VMware       : ${alternate.vmware || 'Not detected'}`,
    `VirtualBox   : ${alternate.virtualBox || 'Not detected'}`,
    `QEMU         : ${alternate.qemu || 'Not detected'}`,
    '',
    `Next         : ${recommendation.nextAction || status.nextAction}`,
    hyperV.managementError ? `HV access note: ${hyperV.managementError}` : '',
    status.lastError ? `Error        : ${status.lastError}` : ''
  ].filter(line => line !== null && line !== '').join('\n');
}
