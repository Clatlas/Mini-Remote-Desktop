# Mini Remote Desktop (MRD) — V0.1 Foundation

Private, Tailscale-only Progressive Web App for controlling and remotely using a Windows 11 Pro PC from an iPhone.

## What is implemented now

- PWA installable from Safari with no TestFlight/App Store subscription.
- Canonical four-state dashboard:
  - **Grey** — Offline
  - **Yellow** — Asleep
  - **Blue** — Online · Unlocked
  - **Green** — Online · Locked
- Live status stream (Server-Sent Events) plus reconnect/offline detection.
- CPU, RAM, and uptime metrics.
- Windows lock-state detection using the Windows `LogonUI` process as the V0.1 detector.
- Guarded Lock, Sleep, Restart, and Shut down APIs. They are disabled by default.
- In-PWA Desktop surface.
- Local reverse proxy for Apache Guacamole, including WebSocket upgrades, so the HTML5 RDP layer stays under the PWA origin.
- Apache Guacamole 1.6.0 + guacd + PostgreSQL Docker Compose foundation.
- Mobile Browser shell and media-first surface prepared for the next milestone.
- Tailscale Serve setup script. The app listens on localhost by default and is intended to be reachable only through Tailscale Serve.

## Architecture

```text
iPhone PWA
   |
   | HTTPS / Tailscale Serve
   v
Mini Remote Desktop (MRD) Host (127.0.0.1:8787)
   |-- status + controls
   |-- /guacamole/* reverse proxy
   |       |
   |       v
   |   Apache Guacamole -> guacd -> RDP -> Windows 11 Pro
   |
   `-- Browser transport (next milestone) -> Chromium on the PC
```

## Requirements

- Windows 11 Pro (or another Windows edition capable of hosting RDP)
- Node.js 20+
- Tailscale on the PC and iPhone
- Docker Desktop for the Guacamole gateway
- A Windows account with a password for RDP

## 1. Enable RDP

Open **PowerShell as Administrator**:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\enable-rdp.ps1
```

Or enable it manually under **Settings > System > Remote Desktop**.

## 2. Start Guacamole

Start Docker Desktop, then:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-guacamole.ps1
```

Open `http://127.0.0.1:8080/guacamole/` locally once.

Initial Guacamole credentials are `guacadmin` / `guacadmin`. Change the password immediately.

Create an RDP connection with:

- Protocol: RDP
- Hostname: `host.docker.internal`
- Port: `3389`
- Username: your Windows username
- Password: your Windows password
- Security mode: `Any` initially; tighten after the connection is proven
- Ignore server certificate: enabled for the first local proof only

The Guacamole container is not published to your LAN; it binds to `127.0.0.1:8080`, and `guacd` is not published at all.

## 3. Start Mini Remote Desktop (MRD)

```powershell
Copy-Item .env.example .env
.\scripts\start.ps1
```

The host listens at `http://127.0.0.1:8787`.

### Enable power controls later

After the dashboard and access path are verified, edit `.env`:

```env
ALLOW_POWER_CONTROLS=true
```

Restart Mini Remote Desktop (MRD). Until then, Lock/Sleep/Restart/Shutdown are visible but deliberately disabled.

## 4. Publish privately with Tailscale Serve

In another PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-tailscale.ps1
```

Tailscale will show a private HTTPS URL such as:

```text
https://your-pc.your-tailnet.ts.net
```

Only devices/users allowed by your tailnet ACLs can reach it. Do **not** use Tailscale Funnel for this project.

## 5. Put it on the iPhone Home Screen

1. Connect Tailscale on the iPhone.
2. Open the Tailscale Serve HTTPS URL in Safari.
3. Tap **Share**.
4. Choose **Add to Home Screen**.
5. Enable **Open as Web App** if prompted.
6. Launch **Mini Remote Desktop (MRD)** from its Home Screen icon.

## Desktop behavior

Tap **Desktop** in Mini Remote Desktop (MRD). The PWA embeds the Guacamole HTML5 client under `/guacamole/`; Guacamole then establishes the actual RDP session to Windows.

The first V0.1 integration intentionally uses Guacamole's existing authenticated web client inside our PWA. The next desktop pass will replace the stock connection-selection feel with a direct, app-controlled connection flow while keeping the mature Guacamole/RDP transport underneath.

## Browser / Media milestone

The Browser screen is already part of the PWA but the remote Chromium transport is intentionally not faked. The next implementation step is:

1. launch/manage Chromium on the PC;
2. create an iPhone-sized mobile browser context;
3. stream the rendered surface to the PWA;
4. return touch/keyboard/scroll input to Chromium;
5. detect media and promote it into the dedicated native-style media surface;
6. use real `<video>` playback semantics where possible for iPhone fullscreen/media controls.

## Status state semantics

`onlineLocked` and `onlineUnlocked` come from the responding Windows host.

`asleep` is retained by the PWA when **Mini Remote Desktop (MRD) itself requested Sleep** and the host then disappears. If the PC disappears unexpectedly, the state becomes `offline`. A later Windows event-monitoring service will make externally initiated sleep/wake transitions authoritative too.

## Security notes

- Mini Remote Desktop (MRD) binds to `127.0.0.1` by default.
- Tailscale Serve is the only intended network exposure.
- RDP port 3389 is not published to the internet.
- Guacamole binds only to localhost.
- `guacd` is isolated inside an internal Docker network and is not published because guacd itself does not authenticate clients.
- Power-control APIs are disabled by default.

## Development demo

On a non-Windows development machine, run:

```bash
PC_REMOTE_DEMO_STATE=onlineLocked npm start
```

Valid demo states: `offline`, `asleep`, `onlineUnlocked`, `onlineLocked`.
