# MRD Native Audio Router — Setup and Validation

MRD v0.1.2 introduces the first native Windows audio-routing transport for the four session destinations:

- **Desktop** — physical PC output only.
- **Mobile** — MRD phone stream only; physical PC output muted while active.
- **Both** — physical PC output plus MRD phone stream.
- **Muted** — neither destination.

The native helper is built from `native/audio-router/main.cpp` by GitHub Actions and published as the rolling `audio-router-latest` release. The installer verifies the downloaded executable against the release SHA-256 file before using it.

## Install on the Windows host

From PowerShell in the MRD repository:

```powershell
git pull
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-audio-router.ps1
.\scripts\start.ps1
```

`start.ps1` installs the required Node packages automatically when they are missing.

The helper is installed by default to:

```text
bin\mrd-audio-router.exe
```

You may override its location with `MRD_AUDIO_HELPER` in `.env`.

## Confirm MRD sees the helper

While MRD is running, open:

```text
http://127.0.0.1:8787/api/audio
```

The response should include:

```json
{
  "transportPhase": "native-router",
  "router": {
    "helperAvailable": true
  }
}
```

`routingApplied` becomes true only while Desktop or Browser mode is active and the selected destination was successfully applied.

## First hardware-validation sequence

This is the first machine-specific validation of the Windows/RDP/audio-driver combination. Use a recognizable audio source and test in this order:

1. Open **Desktop** in MRD.
2. Set Audio to **Mobile**. Expected: phone receives audio; physical output is muted.
3. Set Audio to **Both**. Expected: phone and physical output both play.
4. Set Audio to **Desktop**. Expected: physical output plays; MRD phone stream stops.
5. Set Audio to **Muted**. Expected: neither plays.
6. Exit the MRD session. MRD should restore the physical output's mute state to what it was before the session.

If a mode does not match the expected behavior, capture the `/api/audio` response and note whether Guacamole itself is also producing audio on the phone. RDP audio-redirection behavior can vary with connection settings; MRD deliberately keeps the native router separate so we can correct that without changing the public interface.

## Transport

The helper uses Windows process-loopback capture and emits fixed-format PCM:

- 48,000 Hz
- stereo
- signed 16-bit little-endian PCM

`src/audio-router.mjs` forwards the PCM over the same private MRD origin at:

```text
/api/audio/stream
```

The PWA decodes and schedules the stream through Web Audio. No separate LAN or public audio port is opened.

## Security

- Audio WebSocket traffic remains behind MRD/Tailscale.
- The helper has no network listener of its own.
- The helper binary is built from repository source.
- The installer verifies SHA-256 before use.
- `bin/` is intentionally ignored by Git so a local executable is not silently committed as source.
