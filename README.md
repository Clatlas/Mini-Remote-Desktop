# Mini Remote Desktop (MRD) — v0.1.2

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
- Tailscale Serve setup.
- Apache Guacamole 1.6.0 + `guacd` + PostgreSQL for HTML5 RDP.
- Guacamole HTTP and WebSocket proxying through the MRD origin.
- Browser/media-first mobile interface shell.
- Four-mode audio policy: **Desktop / Mobile / Both / Muted**.
- Native Windows MRD Audio Router transport with a private WebSocket PCM path to the PWA.
- PWA service worker, manifest, and Home Screen icon.

## Architecture

```text
iPhone PWA
   |
   | HTTPS / WSS over Tailscale Serve
   v
MRD Host (127.0.0.1:8787)
   |-- live PC status + controls
   |-- audio policy + MRD Audio Router
   |       |-- Windows process-loopback capture
   |       `-- /api/audio/stream -> iPhone Web Audio
   |-- HTML5 Desktop
   |       |
   |       v
   |   Apache Guacamole -> guacd -> RDP -> Windows 11 Pro
   |
   `-- Browser / Media -> Chromium on the PC (next major milestone)
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

Confirm **Settings > System > Remote Desktop** reports **On**.

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
- Security mode: `Any` for the first local proof
- Ignore server certificate: enabled for the first local proof only

The Guacamole container binds to `127.0.0.1:8080`; `guacd` is not published externally.

## 3. Install the MRD Audio Router

The Windows x64 helper is built from the repository source by GitHub Actions and published as the rolling `audio-router-latest` release. The setup script verifies its SHA-256 checksum before installation.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-audio-router.ps1
```

Default install location:

```text
bin\mrd-audio-router.exe
```

See `docs/AUDIO_ROUTER_SETUP.md` for the validation procedure and implementation notes.

## 4. Start MRD

```powershell
.\scripts\start.ps1
```

If `.env` does not exist, the script creates it from `.env.example`. If required Node packages are missing, it runs `npm install` automatically.

MRD listens at:

```text
http://127.0.0.1:8787
```

## 5. Publish privately with Tailscale Serve

In another PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-tailscale.ps1
```

Tailscale will show a private HTTPS URL similar to:

```text
https://your-pc.your-tailnet.ts.net
```

Use **Tailscale Serve**, not Funnel. MRD is intended to remain private to the tailnet.

## 6. Add MRD to the iPhone Home Screen

1. Connect Tailscale on the iPhone.
2. Open the Tailscale Serve HTTPS URL in Safari.
3. Tap **Share**.
4. Choose **Add to Home Screen**.
5. Enable **Open as Web App** if prompted.
6. Launch **MRD** from the Home Screen.

## Desktop

The Desktop surface is embedded inside the PWA and reverse-proxies Guacamole through MRD. The target behavior is:

```text
Physical monitors -> genuine Windows lock/sign-in screen
Phone             -> active HTML5 RDP desktop inside MRD
```

## Audio routing

MRD exposes the same four destinations in Desktop and Browser / Media sessions:

- `desktop` — physical PC output only.
- `mobile` — MRD phone stream only.
- `both` — physical PC output plus MRD phone stream.
- `muted` — neither destination.

The selected policies persist separately for Desktop and Browser modes. The native helper uses Windows process-loopback capture and streams 48 kHz, stereo, signed 16-bit PCM through `/api/audio/stream` on the existing private MRD origin.

This transport has compiled successfully in the Windows GitHub Actions build. The four routing modes still require first-machine validation against the target PC's real RDP/audio-driver combination; see `docs/AUDIO_ROUTER_SETUP.md`.

## Browser / Media milestone

The Browser surface is intentionally not faked with a normal iframe. The planned implementation is:

1. launch/manage Chromium on the PC;
2. create an iPhone-sized mobile browser context;
3. stream the rendered surface to MRD;
4. return touch, keyboard, and scroll input to Chromium;
5. detect media and promote it into a native-style media surface;
6. support fullscreen/landscape video behavior on iPhone.

## Status semantics

MRD's canonical states are:

- `offline`
- `asleep`
- `onlineUnlocked`
- `onlineLocked`

The Windows host detects the genuine local lock state and reports it to the PWA. Sleep intent is persisted so the phone can distinguish an intentional sleep transition from an unexpected offline state.

## Security principles

- MRD binds to `127.0.0.1` by default.
- Tailscale Serve is the intended network exposure.
- Do not port-forward RDP or MRD to the public internet.
- Guacamole binds only to localhost.
- `guacd` stays inside the internal Docker network.
- The Audio Router helper has no network listener of its own.
- Audio streaming stays on the MRD/Tailscale origin.
- Generated secrets, runtime state, downloaded binaries, and build output are excluded by `.gitignore`.
- Power controls remain disabled until deliberately enabled in `.env`.

## Development

```bash
npm run check
npm start
```

Project shorthand: **MRD**.
