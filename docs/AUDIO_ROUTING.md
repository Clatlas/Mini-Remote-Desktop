# MRD Audio Routing

MRD must expose a session-level **Audio Destination** control for both Desktop Mode and Browser / Media Mode.

## Canonical modes

- `desktop` — audio plays only through the Windows PC's selected physical output.
- `mobile` — audio plays only through the MRD client on the phone.
- `both` — audio plays through both the PC and the MRD client.
- `muted` — audio plays through neither destination.

The UI labels should be **Desktop**, **Mobile**, **Both**, and **Muted**.

## UX requirements

- Audio Destination is a first-class session control, not buried in settings.
- The current destination is always visible while a Desktop or Browser / Media session is active.
- Changing destination should not require disconnecting the MRD session.
- Desktop Mode and Browser / Media Mode may remember separate last-used destinations.
- Media Mode should expose the same setting alongside playback controls.
- The default V1 destination is `mobile` for remote sessions unless the user changes it.

## Desktop Mode implementation

Apache Guacamole / RDP supports audio redirection to the browser and supports disabling redirected audio. Standard Microsoft RDP also distinguishes client playback, host playback, and no playback.

MRD should therefore treat audio routing as its own policy layer rather than relying only on Guacamole connection defaults.

### Desktop

Keep audio on the Windows host and do not send an MRD audio stream to the phone.

### Mobile

Redirect / stream the RDP session audio to the MRD client and suppress playback on the physical PC.

### Muted

Disable remote audio transport and suppress playback on the host for the MRD session.

### Both

This requires duplication because normal RDP audio redirection is not inherently a simultaneous host-and-client output mode. MRD will provide an audio-duplication path that preserves host playback while transmitting a synchronized copy to the phone.

The preferred architecture is an MRD Audio Router on Windows using system/application audio capture plus a low-latency browser-compatible stream to the PWA. The implementation should avoid requiring a public network listener and remain Tailscale-only.

## Browser / Media Mode implementation

The PC-hosted Chromium engine should route audio through the same MRD policy:

- `desktop`: Chromium audio -> Windows physical output only.
- `mobile`: Chromium audio -> MRD media stream only.
- `both`: Windows physical output + MRD media stream.
- `muted`: neither output.

Browser / Media Mode should use the dedicated media transport whenever possible rather than passing media audio through the HTML5 RDP layer.

## API target

Proposed host API:

```text
GET  /api/audio
PUT  /api/audio
```

Example state:

```json
{
  "desktopMode": "mobile",
  "browserMode": "mobile",
  "activeMode": "browser",
  "effectiveDestination": "mobile"
}
```

Example update:

```json
{
  "mode": "desktop",
  "destination": "both"
}
```

Allowed destination values are `desktop`, `mobile`, `both`, and `muted`.

## Security

Audio transport must remain behind the MRD origin / Tailscale path. No standalone audio capture endpoint should be exposed to the LAN or public internet.
