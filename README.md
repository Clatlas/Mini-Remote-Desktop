# Mini Remote Desktop (MRD) — v0.4.0

Private, Tailscale-only Progressive Web App for controlling and remotely using a Windows 11 Pro PC from an iPhone. MRD is optimized around the iPhone 17 Pro Max 440×956 CSS viewport and keeps all remote-compute work on the Windows host.

## Implemented

- Installable iPhone PWA with no TestFlight/App Store dependency.
- Canonical four-state PC status model:
  - **Grey** — Offline
  - **Yellow** — Asleep
  - **Blue** — Online · Unlocked
  - **Green** — Online · Locked
- Live Windows lock-state detection and SSE status updates.
- Dashboard CPU, GPU, RAM, uptime, and connection latency.
- Guarded Lock / Sleep / Restart / Shutdown host controls.
- Tailscale Serve private HTTPS/WSS publishing.
- Two Desktop privacy transports:
  - **Secret** — virtual-display console transport; physical Windows console remains active.
  - **Not Secret** — Guacamole → RDP; physical Windows console locks normally.
- iPhone-first command hub before exposing a raw desktop.
- Persistent Audio, Keyboard, Commands, Touch/Pointer, and Disconnect controls on remote surfaces.
- Four-mode audio policy: **Desktop / Mobile / Both / Muted**.
- Configurable Windows Apps launcher with Add App, reorder, remove, and restore defaults.
- MRD Admin controls plus MRD logs, Guacamole logs, and RDP health diagnostics.
- Remote **Update MRD** action that pulls the latest fast-forward Git changes and restarts the canonical stack.
- Dedicated PC-powered mobile Chromium Browser Engine with tabs, navigation, touch, keyboard, and Media Mode.
- PWA service worker, manifest, safe-area handling, and Home Screen icon.

## Desktop flow

```text
MRD Dashboard
     |
     v
Privacy
  |-- Secret      -> MRD virtual display, no forced Windows console lock
  `-- Not Secret  -> Guacamole/RDP, Windows console locks
     |
     v
Connect
     |
     v
MRD Command Menu
  |-- Audio       (always at the top)
  |-- Browser     -> dedicated mobile Chromium Browser Engine
  |-- Apps
  |-- Full Desktop
  |-- MRD Admin
  |-- Update MRD
  `-- Disconnect
```

When a remote app or Full Desktop is visible, MRD keeps persistent session controls for Audio, Keyboard, Commands, Touch/Pointer, and Disconnect rather than relying on Guacamole edge-swipe menus.

## Privacy modes

### Secret

Secret uses an MRD-owned virtual display instead of RDP:

```text
iPhone MRD
   |
   | HTTPS/WSS through Tailscale Serve
   v
MRD Host
   |-- 880×1912 Windows virtual display
   |-- FFmpeg display capture -> 440×956 phone stream
   |-- touch / pointer / keyboard injection
   `-- native MRD audio capture/routing
```

The physical Windows console stays logged in and is not intentionally forced to the lock screen. The virtual monitor is part of the same logged-in Windows console session, so this is a separate workspace/display, not a second isolated Windows user session.

Secret V1 uses a 20 FPS MJPEG transport for straightforward, debuggable console access. A later low-latency video transport can replace the encoder without changing the higher-level MRD UX.

One-time elevated setup:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-secret-transport.ps1
```

The setup installs/configures the signed Virtual Display Driver and FFmpeg, then verifies that the MRD-sized virtual monitor is exposed by Windows.

### Not Secret

Uses Apache Guacamole 1.6.0 + `guacd` + PostgreSQL and Windows 11 Pro RDP. Windows intentionally locks the physical console when the RDP session takes control.

```text
Physical monitors -> genuine Windows lock/sign-in screen
Phone             -> active MRD RDP display
```

The `MRD Desktop` connection is automatically tuned for direct touch, dynamic sizing, RDP audio, and mobile performance.

## Browser Engine

The Browser Engine is not a web iframe and does not send the user into desktop Chrome UI. Chrome runs on the PC with a dedicated MRD profile and a localhost-only DevTools endpoint.

```text
iPhone Browser UI
      |
      | MRD WSS
      v
MRD Browser Engine
      |
      | Chrome DevTools Protocol
      v
Dedicated Chromium profile on Home PC
```

Implemented Browser features:

- 440×956 mobile viewport with up to 3× device scale factor.
- Address/search bar.
- Back / forward / reload.
- Multiple tabs, new tab, tab switching, and tab closing.
- Direct touch input.
- Explicit iPhone keyboard control.
- PC-side page rendering using Chrome `Page.startScreencast`.
- Dedicated persistent MRD Chrome profile under `.runtime/browser-engine/profile`.
- Browser audio uses the native MRD Audio Router rather than RDP audio.

The Chrome remote-debugging endpoint binds to localhost and is not directly published through Tailscale.

### Media Mode

When the active page exposes playable HTML video/audio, MRD can promote it into Media Mode with:

- fullscreen attempt;
- landscape-orientation request with rotate-device fallback;
- tap to show/hide controls;
- play/pause;
- ±10-second skip;
- seek slider;
- media volume and mute;
- elapsed/duration display.

True iOS system Picture-in-Picture is intentionally not faked in this version. The current Browser Engine transports rendered screencast frames rather than a native `<video>` media stream; native PiP belongs with a later H.264/WebRTC/video-element transport.

## Apps

Default pinned apps:

- Google Chrome
- File Explorer
- Windows Terminal / PowerShell
- Task Manager
- Settings
- GitHub Desktop
- Steam
- Photos
- Aura
- Services
- MRD Admin

The Apps screen now also supports:

- **Add App** — discovers current Windows Start Apps.
- **Reorder** — persists launcher order.
- **Remove** — hides a built-in launcher or deletes a custom pin.
- **Restore defaults** — restores MRD's standard app set.

Custom launchers store Windows AppIDs only and launch through `shell:AppsFolder`; the PWA does not expose arbitrary shell-command execution.

## MRD Admin

Allowlisted actions:

- Open Task Manager.
- Open Services.
- Restart Guacamole + `guacd`.
- Restart Docker Desktop.
- Restart Tailscale.
- Restart the MRD host.
- Update MRD.
- View recent MRD runtime logs.
- View recent Guacamole / `guacd` logs.
- Check RDP service/listener/session health.

MRD runtime logging is written to:

```text
.runtime\mrd.log
```

Generated runtime state, logs, browser profiles, and downloaded helpers remain excluded from Git.

## Audio routing

MRD exposes the same four destinations across supported surfaces:

- `desktop` — physical PC output only.
- `mobile` — iPhone only.
- `both` — physical PC plus iPhone.
- `muted` — neither destination.

Transport differs by surface:

- **Not Secret Desktop** — Guacamole/RDP supplies phone audio; native MRD Audio Router manages physical-PC mute/output.
- **Secret Desktop** — native MRD Audio Router captures/reroutes Windows console audio.
- **Browser Engine** — native MRD Audio Router captures/reroutes PC browser audio.

Native format is 48 kHz stereo PCM over MRD WSS.

## Architecture

```text
iPhone MRD PWA
   |
   | HTTPS / WSS over Tailscale Serve
   v
MRD Host (127.0.0.1:8787)
   |-- live status + CPU/GPU/RAM/uptime
   |-- power controls
   |-- app catalog / launcher
   |-- MRD Admin / diagnostics
   |-- audio policy + native Audio Router
   |
   |-- Not Secret Desktop
   |      `-- Guacamole -> guacd -> RDP -> Windows 11 Pro
   |
   |-- Secret Desktop
   |      `-- virtual display -> FFmpeg -> WSS + input injection
   |
   `-- Browser Engine
          `-- Chrome CDP -> mobile viewport screencast + direct input
```

## Requirements

- Windows 11 Pro for the Not Secret RDP host path.
- Node.js 20+.
- Tailscale on PC and iPhone.
- Docker Desktop for Guacamole/RDP.
- Google Chrome for Browser Engine.
- FFmpeg + Virtual Display Driver for Secret mode (the setup script provisions these).
- A Windows account with a password for RDP.

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

Create the RDP connection named exactly **MRD Desktop**.

### 3. Install the MRD Audio Router

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-audio-router.ps1
```

Default helper location:

```text
bin\mrd-audio-router.exe
```

### 4. Install Secret transport prerequisites

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-secret-transport.ps1
```

This step requires elevation because it installs a Windows display driver.

### 5. Start the complete stack

Use:

```text
Start-MRD.cmd
```

The launcher verifies Docker/Guacamole, applies mobile RDP tuning, restarts the managed Node host using the current code, publishes MRD privately through Tailscale Serve, and verifies that exactly one MRD listener remains.

MRD listens locally at `http://127.0.0.1:8787`. Use the private HTTPS `.ts.net` URL from Tailscale Serve on the iPhone.

## Remote updates

Once MRD is running, **Update MRD** performs a guarded `git pull --ff-only`, runs the canonical `Start-MRD.cmd`, waits for the host to return, and reloads the PWA. It does not expose a general remote PowerShell console.

## Security principles

- MRD binds to `127.0.0.1` by default.
- Tailscale Serve is the intended network exposure; do not use Funnel.
- Do not port-forward RDP, Chrome DevTools, or MRD to the public internet.
- Guacamole binds only to localhost.
- `guacd` stays unpublished inside Docker networking.
- Chrome Browser Engine DevTools binds only to localhost.
- Browser Engine uses a dedicated non-default Chrome profile rather than the user's normal Chrome profile.
- Audio Router and Secret input helpers have no independent public network listeners.
- App/admin operations are allowlisted; arbitrary remote shell commands are not exposed.
- Power controls remain disabled until deliberately enabled in `.env`.

## Development

```bash
npm run check
npm start
```

GitHub Actions validates Node/JavaScript syntax and parses MRD's PowerShell scripts on Windows for every push to `main`.

Project shorthand: **MRD**.
