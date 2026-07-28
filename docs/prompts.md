# Prompts

Reusable prompts for this project, plus the log of prompts already given.
Kept separate from [`project-brief.md`](project-brief.md) so the brief stays a pure status
document.

---

## Claude Project custom instructions

Paste this into the *Elegant Light Control* project's custom-instructions field on claude.ai.

> This project is an Expo/React Native iOS app that controls an aftermarket BLE ambient
> lighting kit in a Mercedes-Benz W205 C-Class. Area 1 = door trim lines + centre console.
> Area 2 = air vents + Burmester tweeter grilles. Use that physical language in user-facing
> copy, not "zone A/B".
>
> Read `CLAUDE.md` for the protocol spec and architecture, and `docs/project-brief.md` for
> decision history and what has already been ruled out.
>
> The controller speaks SmartLed A5: a 20-byte frame on service FFB0, write characteristic
> FFB1. Do not propose ELK-BLEDOM/7E, Triones/56, MagicHome/31, HM-10 AT, AA55, raw RGB, or
> JSON — all 30 combinations were tested and silently ignored. The proprietary 5833FF01
> service is a decoy; it emits a constant 0x69 heartbeat and ignores every write.
>
> The open blocker is verifying A5 frames on FFB1 in the car, and identifying area
> addressing (candidate bytes 3, 11, 18, 19). Tasks 3 (themes) and 4 (interior preview) do
> not depend on that result.
>
> Never suggest blasting payloads across characteristics — that is what broke the original
> implementation. Writes are paced and serialised.

---

## Reusable working prompts

### After an in-car test session

> I tested in the car with build `<label>`. Results: `<what happened per sweep step>`.
> Update CLAUDE.md and docs/project-brief.md with what this rules in or out, then tell me
> the next thing to test.

### Ship a build

> Bump BUILD_LABEL, run the typecheck and the export check, then build the preview profile
> and give me the install link. Tell me what changed since the last build so I know what I
> am testing.

### Start a backlog task

> Start Task `<n>` from the CLAUDE.md backlog. Read the sub-tasks first and tell me if any
> of them are blocked on the protocol result before you write code.

### Protocol dead end

> The A5 frames did not work either. Before proposing anything new, list what we have
> already ruled out and why, then tell me what evidence would actually distinguish the
> remaining possibilities.

### Resume after a gap

> Read CLAUDE.md and docs/project-brief.md and tell me where we left off, what the current
> blocker is, and what I can do without the car.

---

## Prompt log

Every prompt given so far, in order. Session `78803f95`, 2026-07-28 (UTC), recovered after
the folder rename orphaned it.

| Time | Prompt |
| --- | --- |
| 07:03 | Please check ambient-light-controller and review |
| 07:15 | Current app can connect but cannot control after market bluetooth ambient light can you check possibilities? |
| 07:21 | I can only check after deploying to my phone and checking on my car, make neccessary changes and build so that I can run on my phone |
| 07:37 | No there must be Area1 and Area2 and Both it can be controlled seperately |
| 07:47 | How to test? |
| 08:02 | I can provide you the link of App which controls the ambient bluetooth also I would like to implement two additionl things I would like to have Gradient mode which cycles all colors but I would like to cycle selected colors by user 2. I would like to have apple car play support which application should be controlled from car |
| 08:08 | https://apps.apple.com/tr/app/ambient-light-control/id1606377864 The app which can control the bluetooth ambient light in car |
| 08:14 | I don't have Android |
| 09:09 | it didn't work I didn'te think that i correcly connected even |
| 10:52 | How can I update and check? |
| 12:08 | It didn't work check screenshots |
| 19:28 | I tried all 30 protocol nothing worked |
| 19:29 | Yes there is in build status sweep-v3 15 protocols interleaved auto |
| 19:40 | It says unsupported file xapk |
| 19:42 | xapk is in downloads folder |
| 19:44 | I moved the xapk under ambient-light-controller project folder |
| 19:58 | How can I test it? |
| 20:05 | Provide me the link for the build installation |
| 20:07 | Also add a claude.md file 1. add tasks to implement apple car plat support, 2. Gradient function tests such as cycling between colors 3. Themes such as template area1 and area2 color 4. A section on top which shows w205 Mercedes C Class interior how colors applied to area1 and area2. Area 1 is the door lines and center console, area2 ins the air vents and burmeister tweeters |
| 20:21 | I tried as described on command lab after connecting to bluetooth none worked |
| 20:35 | Lets commit this to https://github.com/erdemdurak/elegant-light-control.git |
| 20:36 | Lets change project name elegant-light-control also folder name and commit ro here https://github.com/erdemdurak/elegant-light-control.git also add this on Claude App as Project Elegant Light Control so that I can check also on mobile |

### Session 2 — 2026-07-29

| Prompt |
| --- |
| Lost the last session Xcode reopened where we left? |
| No No the project name is changed from ambient-light-control to elegant-light-control try to recover chat history |
| Import it under projects on Claude.ai so that I can keep track |
| So it cannot be syncronized automatically |
| Ok keep a seperate file for prompts |
