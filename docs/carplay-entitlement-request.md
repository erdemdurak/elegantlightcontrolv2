# CarPlay entitlement request — draft submission

**Form:** <https://developer.apple.com/contact/request/carplay/>

`developer.apple.com/carplay` is only the marketing page. The link on it — *"Request CarPlay
app entitlement"*, also shown at the bottom as *"Tell us about your CarPlay app"* — points at
`/contact/carplay/`, which redirects to the address above.

**Sign in to the Apple Developer account that owns team `Y829B2QFT9` first.** The form is
behind Apple ID authentication and an unauthenticated visit bounces to a login page.

The fields below are what the submission needs to cover; the live form is gated, so treat the
exact labels as approximate and the content as ready to paste.

Read the honest assessment at the bottom before spending time on this. The odds are poor. It
costs a form and nothing else, which is the only reason to do it.

---

## Form fields

| Field | Value |
| --- | --- |
| App name | **Elegant Light** |
| Bundle ID | `com.ambientlightcontroller.mobile` |
| Team ID | `Y829B2QFT9` |
| CarPlay app category | **Driving Task** |
| App Store link | *none — see below* |

---

## Draft description

> Elegant Light is the companion app for an aftermarket ambient interior lighting system
> installed in a Mercedes-Benz W205. It controls two independently addressable lighting zones
> in the cabin — the door trim lines and centre console, and the air vents and tweeter grilles
> — over Bluetooth LE.
>
> The CarPlay interface would consist of a single list of pre-configured lighting presets and
> an on/off control. Choosing a preset is one tap, and the list is short and fixed. There is no
> free-text entry, no media, no scrolling content of unbounded length, and nothing that
> requires reading while the vehicle is moving.
>
> The task belongs in the vehicle: interior lighting is adjusted while seated in the car, most
> often at the start of a journey or when ambient light changes at dusk. Today that requires
> picking up the phone, unlocking it and opening the app, which is precisely the interaction
> CarPlay exists to remove. Voice control via App Intents is already implemented and shipping;
> the CarPlay interface would provide the same small set of actions for drivers who prefer a
> glance and a tap to speaking.

## Safety notes, if asked

- Presets only — no colour picker, no sliders, no per-area editing in the car interface.
- Every action is a single tap and completes immediately, with no confirmation step.
- The list is fixed in length and short enough not to scroll on a typical head unit.
- No text input, no images, no video, no audio.
- All configuration happens on the phone, outside CarPlay.

---

## Honest assessment

**Most likely outcome: declined.** Three reasons, in order of weight.

1. **The category fit is arguable, not obvious.** "Driving task" is meant for tasks *related to
   operating the vehicle* — tolls, roadside assistance, vehicle status. Interior decorative
   lighting is a comfort feature. This is the crux of the request and it is a genuine stretch.
2. **The app is not distributed.** Apple's stated criteria include that the app is substantively
   built and genuinely shipped. An app with no App Store presence, used by one person, fails
   that on its face. Nothing in the draft above hides this, and it should not — misrepresenting
   it would be worse than a rejection.
3. **It is an aftermarket accessory**, not a manufacturer integration. The automaker category
   exists for vehicle makers; this is neither that nor a recognised accessory programme.

**What would genuinely improve the odds**, if you ever cared to:

- Publish the app to the App Store, even privately or as a free listing. That removes reason 2
  entirely and it is the single biggest lever.
- Frame it as a vehicle-control companion rather than a lighting effects app, and drop any
  mention of gradients, strobe or party modes from the submission. Those read as entertainment
  and entertainment is not a category.

**Timeline:** case-by-case with no published SLA. Reports range from a few days to several
weeks. Many requests are never answered at all.

**If it is declined**, nothing is lost and nothing changes: Siri already does the controlling,
and it works. This is a lottery ticket, not a plan.
