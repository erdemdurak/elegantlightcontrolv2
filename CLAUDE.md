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
| 18-19 | Trailing. Default `00 00`; the known-good frame ends `00 AA` |

**Build frames from `lastSuccessSendCmd`, not `currentCmd`.** `DateCenter.java` declares two
templates, and they differ in two bytes:

```
currentCmd         A5FF010005000000FF64 00 00 05ff01ff0101 0000
lastSuccessSendCmd A5FF010005000000FF64 00 01 05ff01ff0101 00aa
                                           ^^                ^^
                                        byte 11            byte 19
```

The second is named *last successful send command* — the best evidence available of a frame
this hardware actually accepted. The first round of in-car testing used frames derived from
`currentCmd`, so **byte 11 = `01` was never sent**. Byte 19 = `AA` was tried alone (Command
Lab "A5 RED end aa") but never together with byte 11.

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

## 4. Commands — bare React Native (no Expo)

**This is v2. Expo and EAS have been removed.** There is no managed workflow, no cloud build,
and no build quota. `ios/` and `android/` are tracked source, edited directly.

```bash
npm run typecheck                     # tsc --noEmit — must be clean
npx react-native bundle --entry-file index.js --platform ios \
  --dev false --bundle-output /tmp/main.jsbundle   # verify the JS bundle builds
npm run pods                          # cd ios && bundle exec pod install
npm run ios:device                    # build + install on a tethered iPhone
```

Everything now builds **locally**, which means the toolchain is a hard prerequisite:

| Requirement | Why |
| --- | --- |
| **Xcode** (full app, not Command Line Tools) | `xcodebuild` does not exist without it |
| **Ruby ≥ 3.1** and **CocoaPods ≥ 1.15** | RN 0.81 pods; the system Ruby 2.6 is too old |
| iPhone tethered by cable | No EAS install page any more — Xcode installs directly |

Run `bundle install` once in `ios/` to get the pinned CocoaPods from the `Gemfile`, then
`npm run pods`. Open `ios/ElegantLightControl.xcodeproj` in Xcode for signing.

The bundle identifier is deliberately **`com.ambientlightcontroller.mobile`**, the same as v1,
so the existing ad-hoc provisioning profile and registered device UDID keep working. It also
means v2 replaces v1 on the phone rather than sitting beside it.

Android is scaffolded but **not configured** — the BLE permissions from v1's `app.json` have
not been transferred to `AndroidManifest.xml` yet. Do that when Android is actually wanted.

### What replaced what

| Expo (v1) | Bare RN (v2) |
| --- | --- |
| `registerRootComponent` from `expo` in `index.ts` | `AppRegistry.registerComponent` in `index.js` |
| `expo-status-bar` | `StatusBar` from `react-native` |
| `react-native-ble-plx` config plugin | `NSBluetooth*UsageDescription` keys in `Info.plist` |
| `app.json` Expo config block | `app.json` (name/displayName) + native project files |
| `eas.json` build profiles | Xcode schemes and configurations |
| `expo export` | `react-native bundle` |

---

## Task backlog

### Task 1 — Apple CarPlay support — **DONE, 2026-08-04**

**Apple granted the CarPlay Driving Task entitlement on 2026-08-04.** The earlier analysis in
this file said a full CarPlay app was unattainable for a lighting accessory. That was wrong —
the request was submitted anyway because it cost nothing, and it was approved.

The entitlement lives in the **provisioning profile**, not the project, so a grant alone
changes nothing. Three things were needed: Apple assigning it to the team, the capability being
enabled on the App ID `com.ambientlightcontroller.mobile`, and the profile regenerated. Only
then does `com.apple.developer.carplay-driving-task` survive into the signed binary.

Driving Task allows CPListTemplate, CPGridTemplate, CPInformationTemplate, CPTabBarTemplate,
CPAlertTemplate and CPActionSheetTemplate, to a depth of five.

**Siri via App Intents is the route, and it works.** Confirmed in the car 2026-08-01.

Two things Apple changed that the old plan missed:

- **iOS 26 allows third-party widgets on the CarPlay Dashboard with no entitlement** — support
  the `systemSmall` family and they appear "even if you don't have a CarPlay app". They are
  **display-only**; interaction is disabled. This is the only way to get anything on the car
  screen. Not built — the user does not want it.
- The old note that 1b "requires `expo prebuild`" was written for v1. v2 is already bare RN
  with a real Xcode project, so that step never applied here.

- [x] **1a. Background BLE + auto-reconnect.** `bluetooth-central` and `audio` in
      `Info.plist`; the app remembers the last controller and reconnects on launch, on
      foreground, and when CarPlay is detected via the audio route.
- [x] **1b. App Intents.** `AmbientIntents.swift` — colour (21 spoken names), preset (12),
      mode, brightness, power. `openAppWhenRun = true`; handover is a JSON blob in
      UserDefaults because Siri cold-launches the app. Note: **AppShortcut phrases accept only
      one parameter**, so area cannot be spoken, and an `Int` cannot appear in a phrase at all,
      which is why brightness is Shortcuts-only.
- [ ] **1c. Native CoreBluetooth path** — **no longer optional.** It was the nice-to-have that
      would let intents run without launching the app; it is now the only way to get back what
      `UIBackgroundModes` → `audio` used to provide. That key was removed for the App Store
      submission (guideline 2.5.4 forbids silent playback as a keep-alive), which cost two
      things: gradient/strobe animating while backgrounded, and **CarPlay taps landing while
      the phone is asleep** — the regression `b2aeaeb` originally fixed. A tap now writes to
      UserDefaults and waits for something to resume the app.
      The fix is to write the A5 frame from Swift over CoreBluetooth so no JS runtime is
      needed: connect to the remembered peripheral, discover `FFB0`/`FFB1`, write 20 bytes.
      Duplicates the frame builder and the theme table in Swift. See
      `docs/app-store-submission.md`.
- [x] **1d. Shortcuts automation** — CarPlay-connect automation opens the app, which then
      applies the day or night profile by itself.
- [x] **1e. Driving-task entitlement request** — **GRANTED 2026-08-04**, against my own
      estimate that it would be declined. See `docs/carplay-entitlement-request.md`.
- [x] **1f. CarPlay app.** `CarPlaySceneDelegate.swift` — a CPListTemplate of the presets plus
      power, one tap each. Handover reuses the Siri UserDefaults path, plus a live event via
      `CarPlayBridge.m` because CarPlay can leave the app backgrounded indefinitely. The scene
      manifest declares **only** the CarPlay role: adding a window-scene role would move the
      app onto the scene lifecycle while this AppDelegate still creates its own UIWindow, which
      launches to a black screen.

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


CLAUDE.md

## Çıktı
- Basit, anlaşılır, gereksiz uzatmadan üret. Fazladan açıklama/dosya/örnek ekleme.
- İstenmeyen refactor, yorum, dokümantasyon ekleme.

## Karar Verme
- Cevaba geçmeden önce planı zihinde netleştir; belirsizlik varsa varsayımı belirtip devam et.
- Birden fazla çözüm varsa en basit + sürdürülebilir olanı seç, gerekçeyi tek satırda özetle.
- Büyük/riskli değişiklik gerekiyorsa önce kısa plan sun, onay bekle.

## Kod Kalitesi
- Basitlik > kısa süreli hız. Spagetti kod, gereksiz soyutlama, aşırı mühendislik yok.
- Mevcut mimari/pattern'e uy (proje konvansiyonlarını bul, kopyala).
- Yeni bağımlılık eklemeden önce mevcut araçlarla çözülüp çözülemeyeceğini kontrol et.
- Tek dosya/fonksiyon çok büyürse böl; ama gereksiz parçalama da yapma.

## Hata Yönetimi
- Silent fail yok; hatayı yut ma, logla veya fırlat.
- try/catch'i sadece anlamlı olduğu yerde kullan, her yeri sarmalama.

## Doğrulama
- Değişiklikten sonra ilgili test/derleme/lint çalıştır, hatayı düzelt.
- Test çalıştırmadan "çalışıyor" deme.

## Güvenlik
- Secret/API key/parola kodun içine gömülmez.
- Kullanıcı girdisini doğrulamadan sorgu/komuta geçirme (SQL injection, XSS vb. dikkat).

## Kapsam
- Sadece istenen değişikliği yap; ilgisiz dosyalara dokunma.
- İstenmeyen dosya/klasör oluşturma.

## Geri Bildirim
- Sonunda kısa özet: değişen dosyalar, alınan kararlar, varsa riskler/sonraki adım.
