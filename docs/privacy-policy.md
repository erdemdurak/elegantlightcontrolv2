# Privacy Policy — Elegant Ambient

**Last updated: 16 September 2026**

Elegant Ambient ("the app") controls Bluetooth LE ambient lighting hardware installed in a
vehicle cabin.

> This file is the link the stores and the app are given: GitHub serves it, and it cannot go
> down independently of the repository. The Netlify site it used to point at vanished without
> anyone noticing. `web/privacy.html` is the same text as a web page, for whenever a site is
> hosted again; the two must be changed together.

## What the app collects

**Nothing.** The app collects no personal data of any kind. There is no account, no sign-in,
no registration, and no way to identify you through the app.

## Purchases

Access to the app is sold through the App Store and Google Play. When you buy or restore a
subscription or the lifetime unlock, the app asks Apple or Google whether this account owns it
and stores the yes-or-no answer on the device.

**Payments are handled entirely by Apple and Google.** No card details, billing address or
other payment information ever reaches the developer. These store requests are the only network
traffic the app makes; there is no analytics, crash reporting or advertising.

## What the app stores

Your settings — chosen colours, brightness, modes, saved presets, schedule intervals, and the
identifier of the last lighting controller you connected to — are stored **only on your own
device**, using the operating system's local storage. They are never uploaded anywhere.

Deleting the app deletes all of it.

## Network access

The app makes **no network requests**. It has no servers, no backend, no cloud storage, and no
third-party services of any kind. It does not contain analytics, advertising, crash reporting,
tracking SDKs, or any other component that transmits data.

## Bluetooth

The app uses Bluetooth Low Energy for one purpose: to find and talk to your ambient lighting
controller, and to send it colour, brightness and power commands.

Bluetooth is not used for location, for proximity detection, for advertising, or for any form
of tracking. The names and identifiers of nearby Bluetooth devices are shown to you on screen
so you can pick your controller, and are not recorded or transmitted.

The app does not request location permission on iOS.

On Android 12 and later it does not request location either: the Bluetooth scan permission is
declared with the `neverForLocation` flag, which is a formal declaration to the operating
system that scan results are not used to derive your location.

On Android 11 and earlier, the operating system will not permit a Bluetooth scan at all
without the location permission, so the app must ask for it on those versions. Even there it
is used solely to satisfy that requirement. The app does not read, use, store or transmit your
location on any version.

## Sharing

Nothing is collected, so nothing is shared, sold, or disclosed to anyone.

## Children

The app is not directed at children and collects no data from anyone, of any age.

## Changes

If this policy ever changes, the revised version will be posted at this address with an updated
date above.

## Contact

Questions about this policy or about the app:

**erdem.durak@gmail.com**
