# MRD Isolated Workspace Architecture

## Product contract

MRD remote access must not depend on the physical Windows console lock state.

Both privacy modes must work while the host PC is locked or unlocked:

- **Secret**: the MRD workspace is isolated from the physical console. A person using the host PC must not see MRD browser/app activity.
- **Not Secret**: MRD uses the same isolated workspace, but no local-visibility guarantee is required.

The privacy selector is therefore a **visibility policy**, not a transport selector.

## Target architecture

```text
MRD iPhone / browser
        |
        v
MRD host control plane
        |
        v
WorkspaceManager
        |
        +-- Hyper-V provider (preferred when available)
        +-- alternate VM provider (future)
        |
        v
Dedicated MRD Windows workspace
        |
        +-- Chrome / Incognito
        +-- pinned apps
        +-- full desktop
        +-- MRD guest agent
        |
        v
MRD video / input / audio transport
```

The physical Windows console is independent of the MRD workspace.

## Invariants

1. Host lock/unlock state does not determine MRD availability.
2. MRD applications are launched inside the isolated workspace, never on a host physical monitor.
3. Secret mode must fail closed if isolation cannot be verified.
4. Not Secret may use the same isolated execution path; it simply omits the Secret visibility guarantee.
5. Disconnecting MRD must not modify or unlock the host physical console.
6. The host control plane remains reachable through Tailscale even when the physical console is locked.
7. Workspace lifecycle and host lifecycle are separate. Restarting the MRD web host should not corrupt the workspace.

## Provider phases

### Phase 1 — Capability probe

`WorkspaceManager` and `scripts/workspace-capability.ps1` inventory:

- Windows edition/build
- firmware virtualization
- SLAT
- active hypervisor
- Hyper-V feature and cmdlets
- VMMS
- Virtual Machine Platform
- Windows Hypervisor Platform
- detected VMware, VirtualBox, or QEMU tooling

No live traffic moves into a VM during this phase.

### Phase 2 — Provision provider

For the selected provider, create a persistent MRD workspace with:

- dedicated virtual disk
- private virtual networking
- fixed MRD identity
- guest agent auto-start
- Chrome and required app support
- restart/recovery policy

### Phase 3 — Guest transport

Move video, input, audio, Chrome launch, app launch, and desktop operations behind the guest agent. The host-side VDD/console transport becomes a compatibility fallback only.

### Phase 4 — Privacy policy

- Secret: verify the guest workspace is not exposed to the physical console before reporting connected.
- Not Secret: use the same guest workspace without asserting local invisibility.

## Current migration rule

Do not add additional behavior that couples Secret or Not Secret to host RDP, LogonUI, physical monitor coordinates, or host console capture. Those mechanisms are transitional and should be retired as the isolated workspace becomes operational.
