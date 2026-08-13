# App Store submission — Elegant Ambient 1.0

Mostly iOS. Android is configured and building a signed AAB as of 2026-08-13 — see the Android
section near the end for its toolchain, signing and the two-week tester requirement.

| | |
| --- | --- |
| App Store name | **Elegant Ambient** |
| Name on the device | **Elegant Light** — `CFBundleDisplayName`, `app.json` `displayName`, and `APP_SPOKEN_NAME` for Siri, all unchanged |
| Bundle ID | `com.ambientlightcontroller.mobile` |
| Team | `Y829B2QFT9` |
| Version / build | `1.0` (`1`) — `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in the pbxproj |
| Devices | iPhone only (`TARGETED_DEVICE_FAMILY = 1`), portrait only |
| Minimum iOS | 15.1 |
| Extras | CarPlay (Driving Task), App Intents / Siri |

---

## What the repo already has

- `PrivacyInfo.xcprivacy` — declares FileTimestamp, UserDefaults and SystemBootTime API use,
  `NSPrivacyCollectedDataTypes` empty, `NSPrivacyTracking` false. Matches reality: no account,
  no server, no analytics, no network calls at all.
- `ITSAppUsesNonExemptEncryption = false` in `Info.plist`, so the export-compliance question is
  answered at upload time and never appears in App Store Connect.
- `com.apple.developer.carplay-driving-task` in the entitlements file, granted 2026-08-04.
- A 1024×1024 icon in `Images.xcassets/AppIcon.appiconset/icon-1024.png`.
- Protocol Sweep, Area Sweep, Command Lab and Diagnostics are **hidden in release builds**.
  They render in a dev build, and in release they come back by tapping the build stamp under
  the connection status seven times. A reviewer will not find a screen that writes arbitrary
  hex to a Bluetooth device.
- No `NSLocationWhenInUseUsageDescription`. iOS BLE central does not need location, and the key
  was present with an empty purpose string, which is rejected on submission.

---

## `UIBackgroundModes` → `audio` — removed, and what it cost

`BackgroundKeepAlive.swift` played a one-second buffer of silence on a loop so iOS kept the app
awake and the JS timer stayed running. Guideline 2.5.4 — *"Multitasking apps may only use
background services for their intended purposes"* — forbids exactly that, and reviewers look
for it specifically when an app declares `audio` and has no audio feature. No wording makes it
compliant; the objection is to what the code does.

**`audio` is gone from `Info.plist`, and both call sites with it.** `bluetooth-central` stays.

Two things regressed, deliberately:

| | Before | Now |
| --- | --- | --- |
| Presets, colours, brightness, power from the phone | ✅ | ✅ |
| Siri actions | ✅ | ✅ — `openAppWhenRun` foregrounds the app |
| Reconnect on launch / foreground / CarPlay | ✅ | ✅ — that is `bluetooth-central` |
| Gradient / strobe while backgrounded | ✅ | ❌ stops when the app suspends |
| **CarPlay taps while the phone is asleep** | ✅ | ❌ queued until something resumes the app |

The second one matters more than it looks — it is the regression commit `b2aeaeb` originally
fixed. `bluetooth-central` grants event-driven wake-ups, not a clock, so nothing substitutes at
this layer. **Task 1c is the fix**: write the A5 frame from Swift over CoreBluetooth so the
CarPlay path needs no JS runtime at all.

Also removed, because they no longer describe anything real: the *"Gradient in background"*
toggle, the `backgroundEffects` field in `AppStateSnapshot`, and `src/ble/backgroundKeepAlive.ts`.
`BackgroundKeepAlive.swift` and its bridge are still in the Xcode project but nothing calls
them — left in place rather than removed from the pbxproj, since Task 1c will rework that area.

---

## Verified locally, 2026-08-08

Release configuration archives clean, unsigned:

```
xcodebuild -workspace ios/ElegantLightControl.xcworkspace -scheme ElegantLightControl \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath <path>.xcarchive CODE_SIGNING_ALLOWED=NO archive
→ ** ARCHIVE SUCCEEDED **
```

The archived app carries both scene roles (`Phone` → `SceneDelegate`, `CarPlay` →
`CarPlaySceneDelegate`), the `Metadata.appintents` bundle Siri needs, a 1.7 MB `main.jsbundle`,
and a dSYM. 22 MB total. `UIBackgroundModes` is `["bluetooth-central"]` alone.

**`com.apple.developer.carplay-driving-task = 1` is present in the installed team profile
`87333da2-8cba-460c-b3cd-a9027aff978f`,** so the capability really is enabled on the App ID and
a distribution profile will inherit it. That was the largest unknown.

**What is missing is signing, and only signing:**

| | |
| --- | --- |
| Apple Development certificate | present — `Erdem Durak (K5TE277PV9)` |
| Apple **Distribution** certificate | **absent on this Mac** |
| App Store provisioning profile | absent — the only profile for this bundle ID is development (`get-task-allow = 1`) |
| App Store Connect app record | not created |
| Upload credentials | no API key in `~/.appstoreconnect/private_keys`, no account in Xcode |

All of it is behind the Apple ID and 2FA, so it cannot be scripted from here without a key.
Note that Xcode 16+ stores profiles in `~/Library/Developer/Xcode/UserData/Provisioning
Profiles/`, not the old `~/Library/MobileDevice/` path.

---

## What only you can do

1. **App Store Connect record** — new app, iPhone, bundle ID `com.ambientlightcontroller.mobile`
   (the App ID already exists, so it will be in the dropdown). Name **Elegant Ambient**: plain
   *Elegant Light* is already reserved by another App Store Connect account, which is why the
   store name and the on-device name differ. SKU `elegant-light-w205`, Full Access.
2. **Distribution provisioning.** The CarPlay capability must be enabled on the App ID *and* the
   **App Store distribution** profile regenerated afterwards. The ad-hoc profile you have been
   using does not work for upload. If the archive fails with *"provisioning profile does not
   include com.apple.developer.carplay-driving-task"*, Xcode's automatic signing has not picked
   up the capability — create the profile manually in the developer portal and switch that
   target to manual signing.
3. **Privacy policy URL** — mandatory, even though nothing is collected. A single page saying
   the app collects, stores and transmits no personal data, keeps its settings on the device
   only, and uses Bluetooth solely to talk to the lighting controller is enough.
4. **Support URL** — mandatory. Can be the same page or a GitHub repo.
5. **Screenshots** at the largest iPhone size. App Store Connect states the exact required
   dimensions on the media page; trust that over anything written here.
6. **App Privacy questionnaire** — answer *no data collected* throughout, consistent with
   `PrivacyInfo.xcprivacy`.
7. **Category** — Utilities as primary. Lifestyle as secondary if you want one.
8. **Age rating** — 4+, nothing to declare.
9. **The demo video.** See below. This is the single highest-value item.

---

## Review notes — paste into App Store Connect

> Elegant Ambient controls an aftermarket Bluetooth LE ambient lighting kit fitted to the cabin
> of a Mercedes-Benz W205. It drives two independently addressable zones: the door trim lines and
> centre console, and the air vents and tweeter grilles.
>
> Note on naming: the app appears on the home screen and in CarPlay as "Elegant Light", which is
> its CFBundleDisplayName. The App Store listing is named "Elegant Ambient" because the shorter
> name was already reserved. Same app, no discrepancy intended.
>
> IMPORTANT — THIS APP REQUIRES SPECIFIC HARDWARE. The lighting controller advertises over
> Bluetooth LE as "YX_FFFF11345411". Without that controller present the app will scan and list
> whatever BLE devices are nearby, but there is nothing to connect to and no visible effect from
> any control. A demo video showing the complete flow on the real hardware is attached.
>
> The video shows, in order: scanning and connecting to the controller; selecting a preset and
> the cabin lighting changing to match; adjusting colour and brightness per zone; switching to
> gradient mode; and the CarPlay preset list operating the same controls from the head unit.
>
> There is no account, no sign-in, no server and no network access of any kind. All settings are
> stored locally with AsyncStorage. Nothing is collected or transmitted.
>
> Bluetooth is used only as a Core Bluetooth central, writing colour and brightness commands to
> the lighting controller.
>
> The bluetooth-central background mode keeps that connection alive and lets iOS restore it, so
> the lights respond when the phone is locked in the car.
>
> CarPlay: the interface is a single CPListTemplate of lighting presets plus a power control,
> one tap each, under the Driving Task entitlement granted to this team on 4 August 2026. It can
> only be exercised with the lighting controller powered and in range; the demo video covers it.

---

## The demo video

Guideline 2.1 explicitly allows a video where hardware is required, and reviewers do watch them.
Attach it in *Review Information → App Review Attachment*, and put a streaming link in the notes
as well in case the attachment is missed.

Shoot it in the car, one continuous take if you can, with the cabin visible:

1. Phone on the Scan screen. Tap Scan, `YX_FFFF11345411` appears, tap it, status shows Connected.
2. Tap a preset — **Burmester** is the clearest — and pan to the door trim and vents changing.
3. Open a zone, drag the colour wheel, show the vents following live.
4. Drag brightness down and back up.
5. Switch to gradient mode, hold for one full cycle.
6. Cut to the head unit, open Elegant Light in CarPlay, tap **Night Drive**, pan to the cabin.

Narrate or caption what is being tapped. Keep it under two minutes. Do not cut between the tap
and the lights changing — that causal link is the entire point of the video.

---

## Uploading — the working command

**First TestFlight upload succeeded 2026-08-08**, build `1`, `processingState = VALID`.

Authentication is an App Store Connect API key with the **Admin** role — App Manager cannot
create certificates, which is what `-allowProvisioningUpdates` needs on a first run. The key
lives at `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8` (mode 600).

**The Key ID and Issuer ID are deliberately not written down here**, because this repository is
public. Both are shown in App Store Connect under *Users and Access → Integrations → App Store
Connect API*; the Key ID is also the `<KEY_ID>` in the filename on disk. The `.p8` itself
downloads exactly once from Apple, is not in git, and losing it means revoking the key and
issuing a new one.

```bash
KEY=<key id from App Store Connect>
ISS=<issuer id from App Store Connect>
P8=$HOME/.appstoreconnect/private_keys/AuthKey_$KEY.p8

xcodebuild -workspace ios/ElegantLightControl.xcworkspace -scheme ElegantLightControl \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath build/ElegantLightControl.xcarchive \
  -allowProvisioningUpdates -authenticationKeyID $KEY \
  -authenticationKeyIssuerID $ISS -authenticationKeyPath $P8 archive

xcodebuild -exportArchive -archivePath build/ElegantLightControl.xcarchive \
  -exportOptionsPlist ios/ExportOptions.plist -exportPath build/export \
  -allowProvisioningUpdates -authenticationKeyID $KEY \
  -authenticationKeyIssuerID $ISS -authenticationKeyPath $P8
```

`ios/ExportOptions.plist` sets `destination = upload`, so the export step uploads directly —
there is no separate `altool` call and no `.ipa` to hand around.

**Bump `CURRENT_PROJECT_VERSION` before every re-upload.** App Store Connect rejects a build
number it has already seen, and the failure comes at the very end of a long upload.

Two things about the archive step that look wrong but are not:

- It signs with the **Development** identity and the team provisioning profile. Distribution
  re-signing happens during export, driven by `ExportOptions.plist`.
- No new certificate appears in `security find-identity`. Xcode uses a cloud-managed signing
  certificate for the upload rather than installing one into the login keychain.

### Known warning

```
Upload Symbols Failed. The archive did not include a dSYM for the hermes.framework
```

Hermes ships as a prebuilt xcframework without a dSYM, so crash reports will not symbolicate
frames inside the JS engine itself. App code symbolicates normally. Not blocking, and not worth
fixing unless a Hermes-internal crash ever needs reading.

---

## Archive and upload — background

```bash
npm run typecheck
npm run pods
```

Then Xcode is the path of least resistance, because it handles signing and the upload in one
flow: open `ios/ElegantLightControl.xcworkspace`, set the destination to **Any iOS Device
(arm64)**, then *Product → Archive* → *Distribute App* → *App Store Connect* → *Upload*.

The command-line equivalent, if you prefer it:

```bash
xcodebuild -workspace ios/ElegantLightControl.xcworkspace \
  -scheme ElegantLightControl -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/ElegantLightControl.xcarchive archive
```

Push it to **TestFlight first** and install from there. TestFlight builds are signed exactly
like the App Store build, so it is the only way to find out before review whether the CarPlay
entitlement actually survived into the distribution profile.

---

## Expected review objections, and the answers

| Objection | Answer |
| --- | --- |
| **2.1** — "we could not connect to any device" | The demo video. Reply pointing at it by timestamp; do not re-explain in prose. |
| **2.5.4** — background audio | Only if `audio` is still declared. See the section above. |
| **4.2** — minimum functionality | Unlikely once the video shows two-zone control, schedules, themes, Siri and CarPlay. If raised, the answer is that the app is a hardware controller, not a wrapper. |
| **CarPlay review** | Handled separately and more slowly than the phone app. The entitlement is already granted, so this is a conformance check of the templates, not a re-litigation of the grant. |

---

## Android — configured and building, 2026-08-13

`./gradlew :app:bundleRelease` produces a signed 44 MB
`android/app/build/outputs/bundle/release/app-release.aab`.

**Toolchain.** The Android Gradle Plugin needs **JDK 17**; this machine's default is Java 11
and the build fails outright on it. Temurin 17 is unpacked at `~/.jdks/jdk-17.0.20+8` and
`~/.gradle/gradle.properties` points Gradle at it with `org.gradle.java.home`. It was installed
as a plain tarball rather than through Homebrew, which aborts here on an unrelated permissions
fault under `/usr/local/lib/node_modules/truffle`. Remove it with `rm -rf ~/.jdks` if wanted.

**Signing.** `~/.android-keys/elegant-upload.jks`, RSA 4096, valid to 2053, alias
`elegant-upload`. Passwords live in `~/.gradle/gradle.properties` as `ELEGANT_UPLOAD_*` —
outside the repository, and `*.jks` is gitignored. `app/build.gradle` defines the release
signing config only when those properties exist, so a machine without the key still builds
(falling back to debug signing, which Play rejects — that is the point of the fallback being
loud rather than silent). Verify what you are about to upload:

```bash
jarsigner -verify -verbose:summary -certs app-release.aab | grep CN=
# must read CN=Erdem Durak, OU=Elegant Ambient — never "Android Debug"
```

**Back the keystore up.** Play can reset a lost upload key, but it is a support round-trip.

**Permissions.** The manifest carries both Bluetooth eras and mirrors `requestPermissions()`
in `bleAmbientController.ts` exactly. Two subtleties worth keeping:

- `neverForLocation` on `BLUETOOTH_SCAN` is what lets the app skip location on Android 12+.
  The JS assumes it is declared; without it, scanning silently returns nothing.
- `react-native-ble-plx` injects uncapped `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`
  as `<uses-permission-sdk-23>`. They are removed with `tools:node="remove"`, leaving only the
  `maxSdkVersion="30"` FINE declaration. Left alone the app would advertise Location on modern
  Android despite never requesting it — visible in the Play listing and awkward in the Data
  Safety form. **Check the merged manifest after touching any of this:**
  `android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/`.

**Icons** are generated from the iOS 1024 icon: legacy square, a genuinely circular
`ic_launcher_round`, and an adaptive icon with a monochrome layer, at all five densities.

**Bump `versionCode` in `app/build.gradle` before every Play upload.** It is 1 now, and Play
refuses a code it has already seen.

### Still to do, and the long pole

- **Nothing Android has ever been run.** No device, no emulator, and BLE does not work in an
  emulator anyway. The permission flow especially is unverified against real hardware.
- **The 12-tester rule.** A personal Play account created after November 2023 must run a
  closed test with **12 testers for 14 continuous days** before it can apply for production.
  That is a two-week floor unrelated to the code — start it as soon as the AAB is uploaded.
- Play listing: description, screenshots (Android sizes differ from the App Store's), Data
  Safety form (answer *no data collected*), privacy policy URL (the same GitHub page works),
  and a content rating questionnaire.
