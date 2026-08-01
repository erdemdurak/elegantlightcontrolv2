# Keeping effects running with the app closed

## The constraint

`effectEngine.ts` computes every animation frame on the phone and writes it over BLE at
110-190 ms intervals (`frameIntervalMs`). iOS suspends a backgrounded app, and a suspended app
has no timer, so gradient and strobe stop the moment you leave the app.

**`bluetooth-central` does not fix this.** It grants event-driven wake-ups — a notification
arriving, a disconnect — not a periodic timer. There is no Info.plist key that gives a
background app a free-running clock.

## Where we already are

| Mode | Colours | Runs with app closed |
| --- | --- | --- |
| **Chip breathe** (`55 03 03 02 02`) | **Yours** — modulates the static colour we set | **yes** |
| Chip gradient / Magic / Symphony | Chip's fixed palettes | yes |
| Our gradient / strobe | Yours | no |

Chip breathe shipped in `lenze-v27` and is confirmed: a colour set by our app kept breathing
after our app was closed. So the gap is specifically **custom-colour *cycling*** in the
background — nothing else.

---

## Step 1 — test whether the gap actually matters (no build needed)

The chip's own gradient modes already run backgrounded. The only question is whether their
fixed palettes are worse *in the car* than colours you pick. That is a judgement call about
how it looks, not something that can be reasoned about from here.

In the car, using the **vendor app** (it already exposes every mode):

1. Select **Gradient**, watch it for a minute while driving
2. Try a couple of **Magic** and **Symphony** entries at a few speeds
3. Close the vendor app and confirm it keeps running

Then decide:

| Verdict | Next |
| --- | --- |
| The chip palettes look fine | Build the hardware-effects UI — mode, pattern, speed, direction. No keepalive, no battery cost, done |
| The fixed colours are the problem | Go to step 2 |

Worth knowing before judging: on an addressable strip these modes chase *along* the fibre,
which our phone-driven effects cannot do at all — they can only fade the whole run as one
colour. The chip version may well look better despite not being your colours.

---

## Step 2 — the audio keepalive (only if step 1 says the palettes are not good enough)

The one approach that works on iOS: declare the `audio` background mode and actually play
silence. iOS then treats the app as an active audio app and never suspends it, so the JS timer
keeps firing and the BLE writes keep going.

### What to build

1. **`ios/ElegantLightControl/Info.plist`** — add `UIBackgroundModes` with `audio` and
   `bluetooth-central`. The file currently has **no** background modes at all.
2. **A native Swift module**, ~40 lines. No dependency: this is bare RN with a real Xcode
   project, so `AVAudioEngine` playing a synthesised silent buffer is enough — no audio asset
   needs shipping.
   - `start()` / `stop()` exported to JS
   - **`AVAudioSession` category `.playback` with option `.mixWithOthers`** — see below
   - Handle `AVAudioSession.interruptionNotification` and restart, or a phone call ends the
     session permanently and effects silently die
3. **`src/ble/backgroundKeepAlive.ts`** — thin `NativeModules` wrapper with a no-op fallback
   so Android and the simulator keep working.
4. **`App.tsx`** — start it when `isPhoneDrivenMode` is true for either area, stop otherwise.
   Never hold it while on a static colour or chip breathe.

### The detail that decides whether this is usable

**`.mixWithOthers` is mandatory.** Without it, activating a playback session *stops your
Burmester audio* the moment an effect starts. That single option is the difference between a
feature you would use and one you would never turn on. Test it with music playing before
believing it works.

### Costs, stated plainly

- **Battery.** The app never sleeps and pushes 6-9 BLE writes a second. Expect it to be
  noticeable on a long drive.
- **Fragility.** A call, or another app taking exclusive audio, kills the session. Handled,
  but not invisible.
- **iOS can still terminate the app** under memory pressure. Nothing prevents that.
- App Store rejection risk is real but **irrelevant here** — this build is ad-hoc and personal.

### Stopgap that needs no code

Leave the app open with **Auto-Lock set to Never** while driving. Crude, screen stays on, but
it works today.

---

## Decision record

- **2026-07-31** — chip breathe implemented and confirmed working backgrounded with our own
  colour. Custom-colour *cycling* in the background remains unsolved; the keepalive is
  deliberately **not** built yet, pending the step 1 verdict on whether the chip's own
  gradient palettes are good enough in the car.
