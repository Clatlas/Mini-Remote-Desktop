# Mini Remote Desktop (MRD) — V0.1 Foundation

Private, Tailscale-only Progressive Web App for controlling and remotely using a Windows 11 Pro PC from an iPhone.

## V0.1 scope

Implemented in the repository now:

- Installable iPhone PWA with no TestFlight/App Store dependency.
- Canonical four-state UI model:
  - **Grey** — Offline
  - **Yellow** — Asleep
  - **Blue** — Online · Unlocked
  - **Green** — Online · Locked
- Dashboard shell for CPU, RAM, uptime, latency, PC controls, Desktop, and Browser.
- Server-Sent Events status channel.
- Tailscale Serve setup.
- Apache Guacamole 1.6.0 + `guacd` + PostgreSQL Docker foundation for HTML5 RDP.
- Windows RDP enablement script.
- Browser/media-first mobile interface shell.
- PWA service worker, manifest, and Home Screen icon.

### Repository baseline limitation

The current `src/server.mjs` is deliberately a safe baseline. It serves the PWA and status channel, but **does not yet execute Windows power actions or proxy the Guacamole/RDP transport**. The UI keeps those actions disabled. Those host-side integrations are the next local implementation step after the baseline is installed and verified on the target PC.

The Docker Guacamole stack and RDP setup scripts are already included so that integration can be wired against the real Windows 11 Pro host rather than mocked.

## Target architecture

```text
iPhone PWA
   |
   | HTTPS / Tailscale Serve
   v
MRD Host (127.0.0.1:8787)
   |-- live PC status + controls
   |-- HTML5 Desktop
   |       |
   |       v
   |   Apache Guacamole -> guacd -> RDP -> Windows 11 Pro
   |
   `-- Browser / Media -> Chromium on the PC
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

Then confirm **Settings > System > Remote Desktop** reports **On**.

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

## 3. Start MRD

```powershell
Copy-Item .env.example .env
.\scripts\start.ps1
```

MRD listens at:

```text
http://127.0.0.1:8787
```

## 4. Publish privately with Tailscale Serve

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

## 5. Add MRD to the iPhone Home Screen

1. Connect Tailscale on the iPhone.
2. Open the Tailscale Serve HTTPS URL in Safari.
3. Tap **Share**.
4. Choose **Add to Home Screen**.
5. Enable **Open as Web App** if prompted.
6. Launch **MRD** from the Home Screen.

## Desktop milestone

The Desktop surface is already present in the PWA and the Guacamole stack is included. The next host-service pass will connect `/guacamole/` through the MRD origin and then streamline Guacamole into a direct app-controlled RDP session rather than a generic connection picker.

The intended end state is:

```text
Physical monitors -> genuine Windows lock/sign-in screen
Phone             -> active HTML5 RDP desktop inside MRD
```

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

The current repository host reports a baseline online state while the Windows-native lock/sleep detector is being integrated. The UI and protocol names are already fixed to the four-state model.

## Security principles

- MRD binds to `127.0.0.1` by default.
- Tailscale Serve is the intended network exposure.
- Do not port-forward RDP or MRD to the public internet.
- Guacamole binds only to localhost.
- `guacd` stays inside the internal Docker network.
- Generated secrets and runtime state are excluded by `.gitignore`.
- Power controls remain disabled until the host integration is verified locally.

## Development

```bash
npm run check
npm start
```

Project shorthand: **MRD**.
