# Elegant Light Control — Project Brief

Upload-ready knowledge file for a Claude Project. `CLAUDE.md` in the repo root is the
authoritative technical spec (hardware, protocol byte map, architecture, task backlog).
**This file holds what the repo does not record: decision history, what was tested and
failed, build history, and the current blocker.**

Last updated: 2026-07-29 · repo `github.com/erdemdurak/elegant-light-control` @ `7d7e4f3f`

---

## One-paragraph summary

React Native (Expo, managed workflow) iOS app that controls an aftermarket Bluetooth LE
ambient lighting kit in a **Mercedes-Benz W205 C-Class**. Two lighting zones: **Area 1** =
door trim lines + centre console, **Area 2** = air vents + Burmester tweeter grilles. The
controller advertises as `YX_FFFF11345411`. The app can connect and write; **whether it can
actually control the lights is unverified in the car.**

---

## Current state

| Item | Status |
| --- | --- |
| Protocol identified | ✅ SmartLed A5, 20-byte frame, service `FFB0` / char `FFB1` |
| Implemented in app | ✅ paced, serialised writer; Protocol Sweep, Area Sweep, Command Lab |
| Verified on hardware | ❌ **not yet — this is the blocker** |
| Area addressing | ❌ unresolved; candidate bytes `[3]`, `[11]`, `[18]`, `[19]` |
| Repo | ✅ pushed, clean tree, `npx tsc --noEmit` passes |
| Build to test | `f3afb323` · iOS · preview · finished 2026-07-28 23:36 |
| Expect this stamp on screen | **`a5-v7 · SmartLed A5 protocol · FFB0/FFB1`** |
| `BUILD_LABEL` in source | `a5-v8` — **not built yet**, EAS free-plan quota resets 2026-08-01 |

`a5-v8` contains no functional change over `a5-v7`: only the label bump and these docs.
Seeing **a5-v7** on the phone is correct and the test is valid.

Verified by unpacking the shipped IPA: its Hermes bundle contains the `a5-v7` label, all
five A5 test frames, the `...0100aa` byte-19 area candidate, and the Command Lab. The A5
work did make it into that build despite it being cut from a dirty tree.

**The single open task: sit in the car, connect, and run Protocol Sweep → Area Sweep.**
Everything else in the backlog is downstream of that result.

---

## How the protocol was found (the part worth not repeating)

1. Started by brute-forcing documented aftermarket BLE LED protocols. **All 30 combinations
   failed** — every write was ACKed and silently ignored. Dead end.
2. The `YX_` device-name convention led to "YX-LED fiber light" modules, and the AZIMOM
   manual for those names the vendor Android app **My SmartLed** (`com.leguangqi.smartled`).
3. Decompiled that APK. `cn/imengduo/lanya/DeviceHelper.java` **hardcodes this controller's
   exact `FFB0`/`FFB1` pair** and builds the 20-byte `A5` frame. No checksum, no handshake,
   no encryption — the app keeps one command string and patches byte ranges in place.

**Ruled out by testing** — do not re-try these: ELK-BLEDOM / `7E` (all model-id bytes),
Triones / LEDBLE `56`, MagicHome `31`, HM-10 AT ASCII, `AA55` frames, raw unframed RGB and
BGR(W), JSON. Also `com.mingmao.zyblack`'s bracketed ASCII protocol — that app binds only
`FFE0`, which this controller does not expose.

**Decoy warning:** the proprietary `5833FF01` service looks like the obvious control channel.
It is not. It emits a constant `0x69` heartbeat and ignores every write. The generic `FFB0`
service is the real one.

### Test frames — send to `FFB1`

Verified 20 bytes each, generated programmatically from the recovered frame layout. These are
the first buttons in the Command Lab.

| | Frame |
| --- | --- |
| RED | `a5ff010005ff00000064000005ff01ff01010000` |
| GREEN | `a5ff01000500ff000064000005ff01ff01010000` |
| BLUE | `a5ff0100050000ff0064000005ff01ff01010000` |
| WHITE | `a5ff010005000000ff64000005ff01ff01010000` |
| OFF | `a500010005000000ff64000005ff01ff01010000` |

### What the failures already established

The connection was never the problem. A populated GATT table plus 40 live notifications
proved the link, and `5833FF02` is write-with-response — every write was ACKed at the ATT
layer with no `error:` lines. The controller received every byte and ignored it. That is a
payload-format problem, not a transport one.

On area addressing: a captured successful send ended `00 AA` where the frame default is
`00 00`, which makes byte `[19]` the strongest of the four candidates.

---

## Design rules learned the hard way

- **Never blast payloads.** The original code sent ~190 writes per action across 6
  characteristics with no pacing. That alone prevented control. Writes are now paced
  (`WRITE_GAP_MS`) and serialised through a queue.
- **One protocol, one characteristic, at a time.** Contradictory frames overwrite each other
  and byte-stream parsers desync. Identification is a deliberate sweep, not a shotgun.
- **Effects are computed on the phone**, not delegated to controller effect codes — cheap
  controllers only store a fixed rainbow, so custom colour cycling is impossible any other
  way. Consequence: effects only run while the app is foregrounded.
- **Brightness is a separate command.** Baking it into the RGB *and* sending a brightness
  byte dims twice.
- **Bump `BUILD_LABEL` in `App.tsx` on every build.** Version confusion already invalidated
  one full round of in-car testing.

---

## Build and deploy

```bash
npx tsc --noEmit                  # must be clean
npx expo export --platform ios    # verify the JS bundle builds
npm run build:ios                 # eas build --platform ios --profile preview
```

Use the **`preview`** profile, never `development` — a dev-client build needs a reachable
Metro bundler, which is useless in a car. Install by opening the EAS build page in **Safari
on the iPhone**. Credentials are provisioned (ad-hoc, device UDID registered).

**Gotcha:** `app.json`'s `slug` is deliberately still `ambient-light-controller`. It is bound
to the existing EAS project ID; changing it locally breaks every build with a slug mismatch
until the project is renamed on expo.dev first. EAS build pages therefore still read
`@erdemdurak/ambient-light-controller`. This is not a bug to fix.

---

## Backlog (full detail in `CLAUDE.md`)

- **Task 1 — CarPlay.** A full CarPlay app is almost certainly unattainable; the entitlement
  covers only specific categories and vehicle lighting fits none. **Siri via App Intents is
  the realistic path.** Blocked on protocol verification. Sub-task 1a (background BLE +
  auto-reconnect) is JS/config only and worth doing on its own merit.
- **Task 2 — Gradient tests.** `src/ble/effectEngine.ts` is pure and fully unit-testable.
  No test infrastructure exists yet; add Jest first.
- **Task 3 — Themes.** Named Area 1 + Area 2 colour-pair presets, applied in one tap.
  Built-ins designed for the W205 cabin: Burmester, AMG, Night Drive, Ice.
- **Task 4 — W205 interior preview.** Inline SVG cabin at the top of the app with two
  tintable regions driven by live area colours.

Tasks 3 and 4 do **not** depend on the protocol result and can proceed now.

---

## Session history

Work to date happened in one long session on 2026-07-28 (07:03 → 20:52 UTC). That session
was orphaned when the project folder was renamed from `ambient-light-controller` to
`elegant-light-control` — Claude Code keys transcripts by directory path. It was recovered
on 2026-07-29 and now resumes normally from the current folder.
