# 07 — Casting to DLNA and Chromecast devices

**Status: experimental. Verified against simulated devices only; not tested on real TVs or Chromecasts.**

Casting sends the video you are watching to a television or speaker-less renderer on your local network. It is off by
default and has no effect until you switch it on in **Settings → Casting**.

## What was and wasn't verified

| Verified (automated tests) | Not verified |
|---|---|
| SSDP, UPnP description and SOAP AVTransport against a loopback fake renderer | Any real DLNA/UPnP TV, receiver or console |
| mDNS query/parse and CASTV2 framing, launch, load, play, pause, seek against a fake TLS Chromecast on loopback | Any real Chromecast, Google TV or Nest device |
| The token-protected stream server: auth, device-IP check, Range, HEAD, method limits | Behaviour on networks with client isolation, VLANs or multicast filtering |
| Transcode planning for a device profile | Vendor quirks (DIDL profiles, `protocolInfo`, codec limits beyond the generic profile) |

Because of this, the UI labels the feature "Experimental" and a device appearing in the list means only that it
answered discovery; it does not mean it can play your file.

## Using it

1. Settings → Casting → turn on **Enable casting**. This also adds a Cast button to the video player controls.
2. Open a video, press **Cast to device**, pick a device. Local playback pauses and the device starts the title.
3. The sheet shows play/pause, a seek bar and **Stop Casting**. Closing the player or playing a different title stops
   the cast.

Turning the setting off stops any running cast, hides the button and closes the stream server.

## How it works

```
renderer (CastSheet)  ──IPC──▶  CastService (main)
                                  ├─ discovery:  ssdp.ts (DLNA)   mdns.ts (Chromecast)
                                  ├─ control:    dlna.ts (SOAP)   castv2.ts (CASTV2 over TLS 8009)
                                  ├─ plan:       shared/cast.ts → shared/playback-plan.ts
                                  └─ media:      server.ts (HTTP, LAN only, while casting)
```

No dependencies were added. SSDP, mDNS, SOAP and the CASTV2 protobuf framing are implemented directly.

### Transcode plan

`planCast` reuses `planPlayback` with a conservative device profile: H.264 up to level 4.2, 8-bit, up to 1080p, no
HDR, AAC or MP3 up to stereo, MP4/M4V containers. Anything outside that is remuxed or transcoded by the existing
playback service and the device receives the live ffmpeg output.

### Seeking

* **Direct files**: the device seeks itself (DLNA `REL_TIME` seek, Chromecast `SEEK`).
* **Remuxed/transcoded**: ffmpeg output is not seekable, so a seek opens a new playback session at the new start time
  and re-points the device at it. The status reports `seekRestarts` and the sheet says so; expect a short pause.

## Security model

Casting is the only feature that listens on the network, so it is deliberately narrow.

* **Opt-in.** Off by default. Nothing is discovered, bound or sent until it is enabled and you open the Cast sheet.
* **Server exists only while casting.** It binds to a single LAN IPv4 address (the local address on the same subnet as
  the device) on an ephemeral port, never `0.0.0.0`. It is closed on stop,
  on failure, when the setting is turned off, and on app quit.
* **Unguessable URL.** Each cast gets a fresh 128-bit random token in the path. Comparison uses `timingSafeEqual`.
* **Device-only.** Requests from any address other than the chosen device's IP get `403`.
* **Minimal surface.** GET and HEAD only (`405` otherwise). HEAD does not start ffmpeg. One title per server; the
  device never sees a file path or database id.
* **SSRF guard.** Device URLs from SSDP are used only if they are `http:`, carry no credentials, and their host is
  exactly the address that answered and is a private IPv4 address. A device cannot redirect Gravity to another host.
* **Untrusted XML.** UPnP responses are capped at 256 KB and read with simple tag extraction; there is no entity or
  DTD processing.
* **Chromecast TLS is not verified.** Chromecasts present self-signed certificates, so the CASTV2 socket uses
  `rejectUnauthorized: false`. The socket is only opened to private addresses found by discovery in this session.
  This means someone on your LAN who can impersonate the device could receive the (token-protected) media URL.
  Do not enable casting on networks you do not trust.
* **No data leaves the LAN.** Nothing is sent to any internet service by this feature.

## Limits

* Video only; no audio-only casting.
* Subtitles are not sent to the device.
* No DLNA `protocolInfo`/DIDL profile tuning per vendor.
* The Chromecast Default Media Receiver (`CC1AD845`) is used; custom receivers are not supported.
* IPv4 only.

## Code map

| Area | Files |
|---|---|
| Shared types, plan, address helpers | `src/shared/cast.ts` |
| Discovery and control | `src/main/cast/{ssdp,dlna,mdns,castv2,xml}.ts` |
| Stream server | `src/main/cast/server.ts` |
| Orchestration | `src/main/cast/service.ts` |
| UI | `src/renderer/player/CastSheet.tsx`, `src/renderer/state/cast.ts`, `src/renderer/views/settings/CastPane.tsx` |
| Tests | `tests/unit/cast.test.ts`, `tests/unit/cast-devices.test.ts`, `tests/e2e/cast.test.ts` |
