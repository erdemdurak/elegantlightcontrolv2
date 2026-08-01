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

## Next trip

Take the **MacBook and the USB cable** for Part B. Part A needs neither.

### Part A — check the v25 fixes (~5 min, phone only)

Build stamp must read `v2 · lenze-v25 · vibrant wheel · static mode`. If it says anything
else you are on the wrong build.

**A1 — the washed-colour fix.** This only tests anything if the controller starts out running
an effect, so put it in one deliberately:

1. Open the **vendor** app, start any **Magic** mode, watch it animate.
2. **Force-quit the vendor app.**
3. Open **ours**, connect.
4. Tap a saturated preset swatch — pure red is the clearest.

| Result | Meaning |
| --- | --- |
| Clean, deep red | The static-mode frame fixed it. Done |
| Still washed | Wrong theory — go to A3 |

**A2 — the wheel.** Drag to the **outer third** of the wheel: colours should now be fully
vibrant well before the rim, instead of only at the very edge. Drag to the **middle**: should
still be visibly pale. Report if either half feels wrong.

**A3 — only if A1 still looked washed.** Capture the vendor app setting a plain static colour
so I can diff its frames against ours byte for byte:

1. Fresh trace, vendor app only, our app force-quit
2. Set **pure red**, both areas → wait 10 s
3. Set **pure blue**, both areas → wait 10 s
4. Save as `static-<date>.pklg`

### Part B — the mode list (~5 min, Mac + cable)

**Screenshots first.** Scroll **Mode selection** to the very top, screenshot; to the very
bottom, screenshot. Same for **Flow mode**. The frames carry numbers; these lists are the only
way to know which number is which name.

Then:

1. Plug in, `File ▸ New iOS Trace…`, confirm packets are scrolling
2. **Force-quit our app** — it now sends a static-mode frame on connect, which would muddy
   the trace
3. In the vendor app, touch **nothing but the Mode selection picker**:
   - **Magic-1** → wait 10 s
   - **Magic-2** → wait 10 s
   - **Magic-3** → wait 10 s
4. Then **Direction**: **Reverse** → wait 10 s → **Posit** → wait 10 s
5. Save as `modes-<date>.pklg`

Three *adjacent* entries is all it takes. If they come out as `0X`, `1X`, `2X` with the same
low nibble, the whole mode list follows by index — exactly as Flow mode did — and nothing else
needs capturing.

Step 4 exists purely because the last trip ended one tap too early: only `24 01` was recorded,
so one of Posit/Reverse is still unknown.

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
