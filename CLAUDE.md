# Ambient Light Controller

React Native (Expo) app for controlling an aftermarket Bluetooth LE ambient lighting kit
installed in a **Mercedes-Benz W205 C-Class**.

---

## 1. The car — what Area 1 and Area 2 actually are

The kit drives two independently addressable lighting zones. Everywhere in this codebase
"Area 1" and "Area 2" map to these physical locations:

| Zone | Physical locations |
| --- | --- |
| **Area 1** | Door trim lines (all four doors) and the centre console |
| **Area 2** | Air vents (turbine vents) and the Burmester tweeter grilles |

This mapping is the single most important piece of context for the UI: users think in terms
of *"the vents"* and *"the door lines"*, not *"zone A"* and *"zone B"*. Prefer the physical
language in user-facing copy wherever it fits.

**Planned:** a visual interior preview at the top of the app (see Task 4) rendering a W205
cabin with these two regions tinted live from the current Area 1 / Area 2 colours, so the
user sees what they are about to send before sending it.

---

## 2. Hardware and protocol status

**Controller:** advertises as `YX_FFFF11345411`. Single BLE device, two areas addressed
through the protocol (not two separate modules).

**GATT layout** (4 characteristics total):

```
5833FF01-9B8B-5191-6142-22A4536EF123        (proprietary vendor service — NOT used)
  ├─ 5833FF02   [Write]                      ← accepts writes, ignores all of them
  └─ 5833FF03   [Notify]                     ← constant 0x69 heartbeat, never changes
0000FFB0                                     (the real control service)
  ├─ 0000FFB1   [Write / WriteNoResponse]    ← send SmartLed A5 frames here
  └─ 0000FFB2   [Notify]
```

**Protocol: recovered from the vendor app.** The controller speaks the **SmartLed A5**
protocol on service `FFB0`, write characteristic `FFB1`.

Source: `com.leguangqi.smartled` ("My SmartLed"), class `cn/imengduo/lanya/DeviceHelper.java`.
That app hardcodes this controller's exact `FFB0`/`FFB1` pair. Found via the `YX_` device-name
convention → "YX-LED fiber light" modules → the AZIMOM manual naming My SmartLed.

A single **20-byte frame carries the entire state**. The app keeps one "current command"
string and patches byte ranges in place, then writes `HexUtil.hexStringToBytes(cmd)` verbatim.
**No checksum, no handshake, no encryption.**

```
A5 FF 01 00 05 00 00 00 FF 64 00 00 05 ff 01 ff 01 01 00 00
```

| Byte | Meaning |
| --- | --- |
| 0 | Header, always `A5` |
| 1 | Switch — `FF` on, `00` off |
| 2 | Mode — `01` static colour, `02` colour temperature, `03` grayscale, else effect number |
| 3 | Mode value − 1 |
| 4 | Speed |
| 5-7 | RGB |
| 8 | White flag — `FF` for pure white (RGB then `000000`), else `00` |
| 9 | Brightness, `0x00`–`0x64` (0–100) |
| 10 | Voice/music flag — `FF` in voice mode |
| 11 | Voice value − 1 |
| 12 | Sound sensitivity |
| 13-14 | Flashing switch (`FF`/`00`) and value |
| 15-17 | Meteor switch, value, speed |
| 18-19 | Trailing. Default `00 00`; a captured successful send ended `00 AA` |

**Area addressing is unresolved.** The vendor app treats multiple light kits as separate BLE
devices (`BlueGroup`, `deviceMap`) and has no in-frame area selector — but this controller
drives two areas over one connection. The unused bytes are the candidates: `[3]`, `[11]`,
`[18]`, `[19]`. The Area Sweep tries each against both numbering bases.

**Ruled out** (30 combinations, every write ACKed and ignored): ELK-BLEDOM/7E all model-id
bytes, Triones/LEDBLE `56`, MagicHome `31`, HM-10 AT ASCII, AA55 frames, raw unframed
RGB/BGR(W), JSON. Also ruled out by testing: the bracketed ASCII protocol from
`com.mingmao.zyblack` — that app binds only `FFE0`, which this controller does not expose.

Note for future work: the proprietary `5833FF01` service is **not** the control channel,
despite looking like the obvious candidate. It emits a constant `0x69` heartbeat and ignores
everything. The generic `FFB0` service is the real one.

---

## 3. Architecture

| Path | Responsibility |
| --- | --- |
| `App.tsx` | All UI. Connect → Protocol Sweep → Area Sweep → Command Lab → Light Control → Diagnostics |
| `src/ble/bleAmbientController.ts` | BLE lifecycle, GATT dump, notifications, sweep plans, profile lock-in, serialised writes |
| `src/ble/protocolFamilies.ts` | Protocol table. Each family builds byte payloads and offers zone-addressing variants |
| `src/ble/effectEngine.ts` | Phone-driven effects — computes each animation frame |
| `src/ble/ambientControllerProtocol.ts` | Decoder for controller status payloads |
| `src/utils/color.ts` | HSV/RGB/hex conversion |

### Design rules learned the hard way

- **Never blast payloads.** The original code sent ~190 writes per action across 6
  characteristics with no pacing; that alone prevented control. Writes are paced
  (`WRITE_GAP_MS`) and serialised through a queue.
- **One protocol, one characteristic, at a time.** Identification happens by sweeping
  deliberately, not by trying everything at once — contradictory frames overwrite each
  other and byte-stream parsers desync.
- **Effects are computed on the phone**, not delegated to controller effect codes. Cheap
  controllers only store a fixed rainbow; custom colour cycling is impossible any other way.
  Consequence: effects only run while the app is foregrounded.
- **Brightness is a separate command.** Never bake brightness into the RGB *and* send a
  brightness value — that dims twice.
- **Bump `BUILD_LABEL` in `App.tsx` on every build.** It renders under the connection
  status and in Diagnostics. Version confusion has already invalidated one round of testing.

---

## 4. Commands

```bash
npx tsc --noEmit                      # typecheck — must be clean
npx expo export --platform ios        # verify the JS bundle builds
npm run build:ios                     # eas build --platform ios --profile preview
```

Use the **`preview`** profile, not `development`. A dev-client build needs a reachable Metro
bundler, which is useless in a car. `preview` is standalone.

Builds install from their EAS build page opened in Safari **on the iPhone**. Credentials are
already provisioned (ad-hoc, device UDID registered).

---

## Task backlog

### Task 1 — Apple CarPlay support

A full CarPlay app is almost certainly unattainable: the entitlement is granted only for
specific categories (audio, communication, navigation, EV charging, parking, fueling, quick
food ordering, driving task, automaker). A vehicle lighting accessory fits none of them.
**Siri via App Intents is the realistic path** — voice control works in CarPlay with no
entitlement. See `docs/carplay-plan.md` for the original analysis.

Blocked on protocol identification. Do not start before control works.

- [ ] **1a. Background BLE + auto-reconnect.** Set `isBackgroundEnabled: true` and the
      `bluetooth-central` background mode in `app.json`; reconnect automatically on
      disconnect and on app foreground. JS + config only, no prebuild. Worth doing on its
      own merit — it fixes connection drops.
- [ ] **1b. App Intents.** Requires `expo prebuild` (moves the project to CNG with native
      iOS directories) plus Swift. Expose: set colour, set area, set brightness, apply
      theme, on/off. Start with `openAppWhenRun = true` so the intent launches the app to
      perform the BLE write — far simpler than 1c.
- [ ] **1c. Native CoreBluetooth path** *(optional)*. Reimplement the writes in Swift so
      intents run without launching the app. Duplicates protocol logic; only worth it if
      1b's launch behaviour proves annoying.
- [ ] **1d. Shortcuts automation** — "when CarPlay connects, apply <theme>".

### Task 2 — Gradient tests

`src/ble/effectEngine.ts` is pure and fully unit-testable — no BLE, no React. There is
currently **no test infrastructure**; add Jest first.

- [ ] **2a.** Add Jest + `ts-jest`.
- [ ] **2b.** `computeEffectRgb` in `gradient` mode: cycles all selected colours in order,
      returns exactly each stop colour at its segment boundary, interpolates monotonically
      between adjacent stops, and wraps from the last colour back to the first.
- [ ] **2c.** Period respects `speed` (1 = slowest … 5 = fastest); one full cycle visits
      every colour exactly once.
- [ ] **2d.** Handles 2 colours (minimum) through 6 (`MAX_GRADIENT_COLORS`); fewer than 2
      is not animated (`isAnimatedMode` returns false).
- [ ] **2e.** `breathe` never returns fully black; `strobe` alternates on/off; brightness
      scales all modes linearly.
- [ ] **2f.** Duplicate and near-identical adjacent colours don't divide by zero or stall.
- [ ] **2g.** Integration: assert the animation loop's write rate stays within
      `frameIntervalMs`, so effects can't saturate the BLE queue.

### Task 3 — Themes

Named presets storing an Area 1 + Area 2 colour pair (and optionally mode, brightness,
speed), applied to both areas in one tap.

- [ ] **3a.** `Theme` type: `{ id, name, area1: LightSettings, area2: LightSettings }`.
      Persist in the existing `AppStateSnapshot` under `STORAGE_KEY`.
- [ ] **3b.** Built-in themes designed for the W205 cabin, e.g.
      *Burmester* (amber vents/tweeters, warm white door lines),
      *AMG* (red Area 2, dim red Area 1),
      *Night Drive* (deep blue both),
      *Ice* (cyan vents, cool white doors).
- [ ] **3c.** Save-current-as-theme, rename, delete, reorder.
- [ ] **3d.** Theme picker as colour-pair swatches, not text — two-tone chips showing both
      area colours at once.
- [ ] **3e.** Applying a theme sends both areas in one action; must respect the
      broadcast fallback when area addressing is not identified.
- [ ] **3f.** Expose themes to App Intents (Task 1b) — "apply Night Drive" is the single
      most useful voice command.

### Task 4 — W205 interior preview

A visual at the **top of the app** showing a stylised W205 cabin with the two zones tinted
live from current Area 1 / Area 2 colours.

- [ ] **4a.** Inline SVG (`react-native-svg`) of a simplified W205 interior — dashboard,
      door card, centre console, turbine vents, tweeter grille. Stylised, not photoreal;
      it must read at a glance.
- [ ] **4b.** Two tintable path groups: **Area 1** = door trim lines + centre console,
      **Area 2** = air vents + Burmester tweeters.
- [ ] **4c.** Fill from live `area1Color` / `area2Color`, with a soft glow so low
      brightness stays visible against the dark background.
- [ ] **4d.** Tapping a region selects that area — replaces the Area 1 / Area 2 / Both
      pills, or complements them.
- [ ] **4e.** Animate the preview from `effectEngine` so gradient/breathe/strobe are visible
      without the car. Must be throttled independently of the BLE write rate.
- [ ] **4f.** Dim the unselected region so the active target is obvious.
