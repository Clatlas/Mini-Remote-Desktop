# Mini Remote Desktop (MRD) — v0.2.0

Private, Tailscale-only Progressive Web App for controlling and remotely using a Windows 11 Pro PC from an iPhone.

## Implemented now

- Installable iPhone PWA with no TestFlight/App Store dependency.
- Canonical four-state PC status model:
  - **Grey** — Offline
  - **Yellow** — Asleep
  - **Blue** — Online · Unlocked
  - **Green** — Online · Locked
- Live Windows lock-state detection, CPU, RAM, uptime, and SSE updates.
- Guarded Lock / Sleep / Restart / Shutdown host controls.
- Tailscale Serve private HTTPS publishing.
- Apache Guacamole 1.6.0 + `guacd` + PostgreSQL for HTML5 RDP.
- Direct MRD Desktop route instead of landing on the generic Guacamole connection chooser.
- Mobile-first Desktop flow: privacy selection → connect → MRD command menu → app/full-desktop surface.
- Persistent Desktop toolbar with **Audio** and **Keyboard** controls.
- Guacamole text-input bridge for opening/closing the iPhone software keyboard without the swipe menu.
- Direct touch/RDPEI and dynamic single-display RDP sizing for the phone viewport.
- Pinned Windows app launcher for Chrome, File Explorer, Windows Terminal/PowerShell, Task Manager, Settings, GitHub Desktop, Steam, Photos, Aura, and Services.
- MRD Admin panel for allowlisted host actions including Guacamole, Docker Desktop, Tailscale, Services, Task Manager, and MRD host restart.
- Four-mode audio policy: **Desktop / Mobile / Both / Muted**.
- Desktop phone audio through Guacamole/RDP, with the native MRD Audio Router controlling physical-PC mute/output state.
- Native PCM/WebSocket audio transport retained for the dedicated Browser/Media engine.
- PWA service worker, manifest, and Home Screen icon.

## Desktop flow

```text
MRD Dashboard
     |
     v
Privacy
  |-- Secret      (transport reserved; see below)
  `-- Not Secret  (Windows RDP)
     |
     v
Connect
     |
     v
MRD Command Menu
  |-- Audio   (always first)
  |-- Browser -> dedicated Chrome window
  |-- Apps
  |-- Full Desktop
  |-- MRD Admin
  `-- Disconnect
```

When a Windows app or Full Desktop is open, MRD keeps a compact toolbar above the remote surface:

```text
Back to Commands | Audio | Keyboard
```

The keyboard button controls Guacamole's text-input bridge directly, avoiding the browser/Guacamole edge-swipe conflict on iPhone.

## Privacy modes

### Not Secret — implemented

Uses the proven Guacamole → RDP → Windows 11 Pro path. Windows intentionally locks the physical console when the RDP session takes control.

```text
Physical monitors -> genuine Windows lock/sign-in screen
Phone             -> active MRD RDP display
```

The RDP connection is configured as a single dynamic virtual display based on the current phone viewport instead of inheriting a fixed monitor size.

### Secret — transport contract implemented, console transport pending

Secret mode is present in MRD's pre-connect UI and session API, but MRD intentionally does **not** fake this mode using normal RDP. Standard Windows client RDP locks/disconnects the local console by design, which violates the Secret-mode requirement.

A complete Secret mode therefore needs a separate local-console/virtual-display capture-and-input transport. Until that transport is installed, selecting Secret is rejected clearly instead of silently falling back to Not Secret/RDP.

## Pinned apps

The initial allowlisted app catalog is:

- Google Chrome — opens a dedicated `--new-window` at Google.
- File Explorer.
- Windows Terminal with PowerShell fallback.
- Task Manager.
- Windows Settings.
- GitHub Desktop.
- Steam.
- Microsoft Photos.
- Aura.
- Services.
- MRD Admin.

The host accepts app IDs from this fixed catalog only; MRD does not expose arbitrary shell-command execution through the PWA.

## MRD Admin

Current allowlisted actions:

- Open Task Manager.
- Open Services.
- Restart Guacamole + `guacd`.
- Restart Docker Desktop.
- Restart Tailscale.
- Restart the MRD host.

Actions that interrupt the current transport are confirmed before execution. Some Windows service operations can still require the MRD host to be running elevated.

## Architecture

```text
iPhone PWA
   |
   | HTTPS / WSS over Tailscale Serve
   v
MRD Host (127.0.0.1:8787)
   |-- live PC status + controls
   |-- session/privacy policy
   |-- allowlisted Windows app/admin launcher
   |-- audio policy + MRD Audio Router
   |-- HTML5 Desktop
   |       |
   |       v
   |   Apache Guacamole -> guacd -> RDP -> Windows 11 Pro
   |
   `-- Browser / Media -> dedicated Chromium transport (future milestone)
```

## Requirements

- Windows 11 Pro (or another Windows edition capable of hosting RDP)
- Node.js 20+
- Tailscale on the PC and iPhone
- Docker Desktop for the Guacamole gateway
- A Windows account with a password for RDP

## Setup

### 1. Enable RDP

Open PowerShell as Administrator:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\enable-rdp.ps1
```

### 2. Initialize Guacamole

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-guacamole.ps1
```

Create the RDP connection named exactly **MRD Desktop**. MRD's startup routine tunes this connection for direct touch, dynamic sizing, RDP audio, and mobile performance, then stores its connection ID for direct launch.

### 3. Install the MRD Audio Router

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-audio-router.ps1
```

Default helper location:

```text
bin\mrd-audio-router.exe
```

### 4. Start the complete stack

Use the root launcher:

```text
Start-MRD.cmd
```

The launcher:

1. checks for accidental duplicate MRD instances;
2. stops the previous managed Node host so newly pulled code is actually loaded;
3. starts/verifies Docker and Guacamole;
4. tunes the `MRD Desktop` connection;
5. starts one MRD host instance;
6. publishes it privately through Tailscale Serve;
7. verifies the final single-instance state.

MRD listens locally at `http://127.0.0.1:8787`. Use the private HTTPS `.ts.net` URL shown by Tailscale Serve on the iPhone.

## Audio routing

MRD exposes the same four destinations throughout the Desktop session:

- `desktop` — physical PC output only.
- `mobile` — iPhone only.
- `both` — physical PC plus iPhone.
- `muted` — neither destination.

For Desktop, Guacamole/RDP is the phone-audio transport and the MRD Audio Router controls whether physical output remains muted or active. The native 48 kHz stereo PCM/WebSocket capture path remains available for the dedicated Browser/Media engine.

## Browser / Media milestone

The separate Browser Engine is intentionally not faked with an ordinary iframe. Until that transport is built, the Desktop command menu's **Browser** action launches a dedicated Google Chrome window inside the active Windows session.

The later Browser Engine remains planned as a mobile-native Chromium rendering/media transport with an iPhone-sized context, direct touch/keyboard input, and fullscreen media handling.

## Security principles

- MRD binds to `127.0.0.1` by default.
- Tailscale Serve is the intended network exposure; do not use Funnel.
- Do not port-forward RDP or MRD to the public internet.
- Guacamole binds only to localhost.
- `guacd` stays unpublished inside Docker networking.
- The Audio Router helper has no network listener of its own.
- App and admin launching is allowlisted; arbitrary remote shell commands are not exposed.
- Generated secrets, runtime state, downloaded binaries, and build output are excluded by `.gitignore`.
- Power controls remain disabled until deliberately enabled in `.env`.

## Development

```bash
npm run check
npm start
```

Project shorthand: **MRD**.
