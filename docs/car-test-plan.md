# Car run sheet

## Where the protocol stands

Confirmed on the wire, in the car:

| Frame | Meaning |
| --- | --- |
| `55 07 04 R1 G1 B1 R2 G2 B2 CK AA` | Colour. Bytes 3-5 Area 1, 6-8 Area 2 |
| `55 03 02 B1 B2 CK AA` | Brightness, one byte per area, `0x00`-`0x64` |
| `55 02 05 00/01 CK AA` | Power off / on. Off was echoed back by the controller |
| `55 02 23 S CK AA` | Effect speed, 1-5 |
| `55 02 24 D CK AA` | Direction. Only `01` seen — the other value is still missing |
| `55 02 22 M CK AA` | Flow mode. High nibble = index-1, low nibble = family:<br>`follow-N` = `(N-1)<<4 \| 0x0a`, `Symphony-N` = `(N-1)<<4 \| 0x0b` |
| `55 03 03 A1 A2 CK AA` | One byte per area. `00 00` before a static colour, `01 01` before an effect — reads as static-vs-dynamic |
| `55 01 00 CK AA` / `55 01 01 CK AA` | Query state / query info |

**Hardware effects are confirmed.** Selecting a mode produces one frame, then 9-15 seconds of
complete silence while the lights keep animating. The controller runs them itself, so they
will survive the app being closed. They use the chip's own fixed palettes, so they cannot
cycle colours you pick — that stays phone-driven and app-open.

**Still missing:** which frame corresponds to which entry in the *Mode selection* list, and
the second Direction value.

---

## Testing `lenze-v42`

Three stages. The first needs no car at all, so do it at the desk and only take working
software down to the garage.

### Stage 1 — at the desk (~10 min)

Build stamp under the connection status must read `v2 · lenze-v42 · voice reference`.

**Connect once manually first.** The app was reinstalled, so its stored state is gone —
it does not know the controller yet and auto-reconnect cannot fire until it does.

1. **Mode row** — Mono / Gradient / Strobe / Breathe / Auto should all fit without wrapping
   awkwardly.
2. **Palette** — 26 swatches, six per row, reading as a spectrum from red round to white. Tap
   a few and check the colour on the strip matches the swatch. The two salmons are meant to
   look paler than the rest; nothing else should.
3. **Saved colours** — pick something off the wheel, **+ Save Current Colour**. It should
   appear *below a thin horizontal line*, separate from the built-ins, and long-press should
   delete it. The line only exists once you have saved something.
4. **Swap** — the fourth pill beside Area 1 / Area 2 / Both. Set the two areas to obviously
   different colours, tap it, and confirm they exchange.
5. **Night Drive** preset — now `#000FFF` doors and `#1500FF` vents.
6. **Voice Commands card** at the bottom — tap to expand and check the lists read correctly.
2. **Day / Night section**, at the bottom:
   - Set the cabin up in Light Control the way you want it for daytime, then **Save Current**
     under *Day*. The two rows should update to that colour, brightness and mode.
   - Change the cabin, then **Save Current** under *Night*.
   - Press **Apply Now** on each and confirm the lights match what the rows show.
   - Turn **Automatic on connect** on.
3. **Siri**, phone unlocked, app force-quit each time:
   - "Hey Siri, set Elegant Light to amber"
   - "Hey Siri, Elegant Light AMG"
   - "Hey Siri, set Elegant Light mode to breathe"
   - "Hey Siri, turn off Elegant Light"
4. **Shortcuts app** — open it and confirm *Set Light Brightness* and *Set Light Mode* now
   appear alongside the three older actions. Brightness deliberately has no spoken phrase.

### Stage 2 — build the automation (~5 min, at the desk)

Shortcuts → **Automation** → **+** → **CarPlay** → **When CarPlay Connects** → **Run
Immediately** (not *Run After Confirmation*, or it will ask every single time).

Add one action: **Open App → Elegant Light**. That is enough — with Automatic on connect
switched on, the app picks Day or Night by itself once it sees the car.

Only add explicit *Apply Light Preset* / *Set Light Brightness* actions if you want to
override the automatic choice.

### Stage 3 — in the car

1. **Plug in.** Expect: app comes forward, connects on its own, and the correct profile for the
   time of day applies. Note how long the whole chain takes.
2. **Check the profile matched the clock** — night is 19:00-07:00.
3. **Siri while driving**, hands-free through the car microphone: a colour, then a preset.
4. **Chip modes survive backgrounding** — set Breathe, close the app, confirm it keeps
   breathing your colour. Repeat with Auto, which should cycle the chip's own palette.
5. **Phone-driven modes need the keepalive** — set Gradient, lock the phone, and check it keeps
   cycling. This is the audio keepalive being exercised for the first time in the car.
6. **Music test, the important one** — start music, then start a Gradient. If the music stops,
   `.mixWithOthers` is not doing its job and I need to know.

### What to write down

- Whether the app foregrounding on CarPlay connect actually bothers you. That single answer
  decides whether the native CoreBluetooth rewrite is worth doing.
- Anything in stage 3 that did not happen.

### Still uncaptured, if you have the Mac with you

- **Mode selection list names** — the frames carry a number and I still cannot map numbers to
  names. Screenshots of the list scrolled to top and bottom would settle it.
- **The second Direction value** — both captures caught only `24 01`.

---

## Optional — finish the mode-list capture (Mac + cable, ~5 min)

Only worth doing if you want the chip's own patterns named in the app. Everything else is
decoded.

**Screenshots first.** Scroll **Mode selection** to the very top, screenshot; to the very
bottom, screenshot. Same for **Flow mode**. The frames carry numbers; these lists are the only
way to know which number is which name.

Then:

1. Plug in, `File ▸ New iOS Trace…`, confirm packets are scrolling
2. **Force-quit our app** — it sends a static-mode frame on connect, which would muddy the trace
3. In the vendor app, touch **nothing but the Mode selection picker**:
   **Magic-1** → 10 s → **Magic-2** → 10 s → **Magic-3** → 10 s
4. Then **Direction**: **Reverse** → 10 s → **Posit** → 10 s
5. Save as `modes-<date>.pklg`

Three *adjacent* entries is all it takes — if they come out `0X`, `1X`, `2X` with the same low
nibble, the whole list follows by index, exactly as Flow mode did.

Step 4 exists because both previous captures ended one tap too early: only `24 01` was ever
recorded, so one of Posit/Reverse is still unknown.

**Leave "Number of lamp" at 30.** It is the pixel count of the strip, not an effect setting.

---

## Rules that killed an earlier attempt

- **No Rhythm modes** — microphone-driven, out of scope. Leave **Sound sens** at 0.
- **Rest ~10 s after every action.** The gaps are what let me line frames up against actions.
- **Save before walking back.** PacketLogger auto-names traces by timestamp and drops them in
  your home folder; `captures/` is where they should end up, but I can find them either way.
- Write down the order you actually did things in. If you skip or reorder something, say so.

---

## When you're back

```bash
cd ~/Projects/elegant-light-controlv2
python3 tools/parse-hci.py captures/<file>.pklg --min-len 3
```

Paste me the output and your notes.

## Reference

```
55 | LEN | CMD | payload… | CKSUM | AA        LEN   = bytes of CMD + payload
                                              CKSUM = ~(LEN + CMD + payload) & 0xFF
```

Known-good frames for spotting an anchor in a trace:

| Frame | Meaning |
| --- | --- |
| `55 07 04 ff0102 ff0102 f0 aa` | red, both areas |
| `55 07 04 ff0102 0101fd f3 aa` | Area 1 red, Area 2 blue |
| `55 01 00 fe aa` | query state |

Command bytes accounted for so far: `0x00`, `0x01`, `0x02`, `0x03`, `0x04`, `0x05`, `0x22`,
`0x23`, `0x24`. Anything else appearing in a trace is new and worth telling me about.
