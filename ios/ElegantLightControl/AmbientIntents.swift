import AppIntents
import Foundation

/**
 Siri / Shortcuts control.

 A full CarPlay app is not attainable — the entitlement is granted only for a fixed set of
 categories and a lighting accessory fits none of them. App Intents need no entitlement at
 all and still work hands-free while driving, which makes this the only realistic route to
 voice control in the car.

 Every intent sets `openAppWhenRun`, so Siri launches the app and the app performs the BLE
 write. The alternative — reimplementing the Lenze protocol in Swift so intents run without
 launching — would duplicate `protocolFamilies.ts` and everything learned in it. Not worth it
 unless the launch behaviour proves annoying in practice.

 Handover is a JSON blob in UserDefaults rather than a live bridge, because the app is
 usually being cold-launched by the intent and there is no JS runtime to talk to yet. JS
 drains it on foreground; see `consumePendingCommand`.
 */
enum PendingCommand {
  static let key = "pendingSiriCommand"

  static func write(_ payload: [String: String]) {
    guard
      let data = try? JSONSerialization.data(withJSONObject: payload),
      let json = String(data: data, encoding: .utf8)
    else {
      return
    }

    UserDefaults.standard.set(json, forKey: key)
  }
}

@available(iOS 16.0, *)
enum LightAreaOption: String, AppEnum {
  case doors
  case vents
  case both

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Area")
  static var caseDisplayRepresentations: [LightAreaOption: DisplayRepresentation] = [
    .doors: "door lines",
    .vents: "vents",
    .both: "both areas",
  ]

  /// Matches ControlTarget in src/types.ts.
  var target: String {
    switch self {
    case .doors: return "area1"
    case .vents: return "area2"
    case .both: return "both"
    }
  }
}

/**
 Spoken colours, drawn from `presetColors` in App.tsx.

 Not all 26 swatches are here. The palette holds several pairs that differ by a handful of
 values — four near-identical blues, and two teals ten apart in one channel — and offering
 Siri "blue two" against "blue three" would only make recognition worse without giving the
 driver anything new. Each near-duplicate group is represented once, by its clearest name.
 */
@available(iOS 16.0, *)
enum LightColorOption: String, AppEnum {
  case red, orange, deepOrange, lightOrange, salmon, warmWhite
  case yellow, warmYellow, lime, yellowGreen, green
  case teal, turquoise, babyBlue, lightBlue, blue
  case violet, purple, pink, magenta, white

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Colour")
  static var caseDisplayRepresentations: [LightColorOption: DisplayRepresentation] = [
    .red: "red",
    .orange: "orange",
    .deepOrange: "deep orange",
    .lightOrange: "light orange",
    .salmon: "salmon",
    .warmWhite: "warm white",
    .yellow: "yellow",
    .warmYellow: "warm yellow",
    .lime: "lime",
    .yellowGreen: "yellow green",
    .green: "green",
    .teal: "teal",
    .turquoise: "turquoise",
    .babyBlue: "baby blue",
    .lightBlue: "light blue",
    .blue: "blue",
    .violet: "violet",
    .purple: "purple",
    .pink: "pink",
    .magenta: "magenta",
    .white: "white",
  ]

  var hex: String {
    switch self {
    case .red: return "#FF0000"
    case .orange: return "#FF2100"
    case .deepOrange: return "#FF5300"
    case .lightOrange: return "#FF9100"
    case .salmon: return "#FFCB3D"
    case .warmWhite: return "#FFBB70"
    case .yellow: return "#FFFF00"
    case .warmYellow: return "#FFF600"
    case .lime: return "#B4FF00"
    case .yellowGreen: return "#57FF00"
    case .green: return "#00FF00"
    case .teal: return "#00FFA3"
    case .turquoise: return "#00FFF7"
    case .babyBlue: return "#00BBFF"
    case .lightBlue: return "#005FFF"
    case .blue: return "#0000FF"
    case .violet: return "#3800FF"
    case .purple: return "#A400FF"
    case .pink: return "#FF00D3"
    case .magenta: return "#FF009E"
    case .white: return "#FFFFFF"
    }
  }
}

/// Raw values are the `id`s in src/themes.ts. Adding a preset there means adding it here.
@available(iOS 16.0, *)
enum LightPresetOption: String, AppEnum {
  case burmester
  case amg
  case nightDrive = "night-drive"
  case ice
  case sunset
  case lounge
  case copper
  case emerald
  case nightshade
  case dusk
  case ultraviolet
  case dune
  case meadow
  case bloom
  case alpine

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Preset")
  static var caseDisplayRepresentations: [LightPresetOption: DisplayRepresentation] = [
    .burmester: "Burmester",
    .amg: "AMG",
    .nightDrive: "Night Drive",
    .ice: "Ice",
    .sunset: "Sunset",
    .lounge: "Lounge",
    .copper: "Copper",
    .emerald: "Fern",
    .nightshade: "Nightshade",
    .dusk: "Dusk",
    .ultraviolet: "Ultraviolet",
    .dune: "Dune",
    .meadow: "Meadow",
    .bloom: "Bloom",
    .alpine: "Alpine",
  ]

  /// Plain text for the CarPlay list. `caseDisplayRepresentations` holds LocalizedStringResource,
  /// which is awkward to render into a CPListItem, and this keeps one list rather than a copy.
  var displayName: String {
    switch self {
    case .burmester: return "Burmester"
    case .amg: return "AMG"
    case .nightDrive: return "Night Drive"
    case .ice: return "Ice"
    case .sunset: return "Sunset"
    case .lounge: return "Lounge"
    case .copper: return "Copper"
    case .emerald: return "Fern"
    case .nightshade: return "Nightshade"
    case .dusk: return "Dusk"
    case .ultraviolet: return "Ultraviolet"
    case .dune: return "Dune"
    case .meadow: return "Meadow"
    case .bloom: return "Bloom"
    case .alpine: return "Alpine"
    }
  }
}

@available(iOS 16.0, *)
enum LightPowerOption: String, AppEnum {
  case on
  case off

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "State")
  static var caseDisplayRepresentations: [LightPowerOption: DisplayRepresentation] = [
    .on: "on",
    .off: "off",
  ]
}

@available(iOS 16.0, *)
struct SetLightColorIntent: AppIntent {
  static var title: LocalizedStringResource = "Set Light Colour"
  static var description = IntentDescription("Sets the ambient lighting to a colour.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Colour")
  var color: LightColorOption

  @Parameter(title: "Area", default: .both)
  var area: LightAreaOption

  func perform() async throws -> some IntentResult {
    PendingCommand.write(["type": "color", "value": color.hex, "area": area.target])
    return .result()
  }
}

@available(iOS 16.0, *)
struct ApplyLightPresetIntent: AppIntent {
  static var title: LocalizedStringResource = "Apply Light Preset"
  static var description = IntentDescription("Applies a saved colour pair to both areas.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Preset")
  var preset: LightPresetOption

  func perform() async throws -> some IntentResult {
    PendingCommand.write(["type": "preset", "value": preset.rawValue])
    return .result()
  }
}

@available(iOS 16.0, *)
enum LightModeOption: String, AppEnum {
  case monochrome
  case breathe
  case auto
  case gradient
  case strobe

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Mode")
  static var caseDisplayRepresentations: [LightModeOption: DisplayRepresentation] = [
    .monochrome: "solid colour",
    .breathe: "breathe",
    .auto: "auto",
    .gradient: "gradient",
    .strobe: "strobe",
  ]
}

@available(iOS 16.0, *)
struct SetLightBrightnessIntent: AppIntent {
  static var title: LocalizedStringResource = "Set Light Brightness"
  static var description = IntentDescription("Sets ambient lighting brightness, 0 to 100.")
  static var openAppWhenRun: Bool = true

  // No spoken phrase for this one: AppShortcut phrases only accept AppEnum parameters, and
  // an Int cannot appear in one. It is reachable from the Shortcuts app, which is where the
  // CarPlay-connect automation lives anyway.
  @Parameter(title: "Brightness", inclusiveRange: (0, 100))
  var brightness: Int

  @Parameter(title: "Area", default: .both)
  var area: LightAreaOption

  func perform() async throws -> some IntentResult {
    PendingCommand.write([
      "type": "brightness",
      "value": String(brightness),
      "area": area.target,
    ])
    return .result()
  }
}

@available(iOS 16.0, *)
struct SetLightModeIntent: AppIntent {
  static var title: LocalizedStringResource = "Set Light Mode"
  static var description = IntentDescription("Chooses solid colour, breathe, auto, gradient or strobe.")
  static var openAppWhenRun: Bool = true

  @Parameter(title: "Mode")
  var mode: LightModeOption

  @Parameter(title: "Area", default: .both)
  var area: LightAreaOption

  func perform() async throws -> some IntentResult {
    PendingCommand.write(["type": "mode", "value": mode.rawValue, "area": area.target])
    return .result()
  }
}

@available(iOS 16.0, *)
struct SetLightPowerIntent: AppIntent {
  static var title: LocalizedStringResource = "Turn Lights On or Off"
  static var openAppWhenRun: Bool = true

  @Parameter(title: "State")
  var state: LightPowerOption

  func perform() async throws -> some IntentResult {
    PendingCommand.write(["type": "power", "value": state.rawValue])
    return .result()
  }
}

/**
 Every phrase is "Elegant Light" followed by what you want, so there is one shape to remember
 rather than a different preposition per intent. The longer forms stay as alternates because
 Siri matches any of them.

 The four short forms all look like `Elegant Light «enum»`. That is fine because the four
 enums share no words — a colour is never also a preset name — so there is nothing for Siri to
 confuse. Adding an overlapping value to any of them would break that.
 */
@available(iOS 16.0, *)
struct AmbientShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SetLightColorIntent(),
      // One parameter per phrase is a hard limit of AppShortcuts, so area cannot be spoken.
      // It stays a parameter on the intent itself, settable in the Shortcuts app.
      phrases: [
        "\(.applicationName) \(\.$color)",
        "\(.applicationName) colour \(\.$color)",
        "Set \(.applicationName) to \(\.$color)",
      ],
      shortTitle: "Set Colour",
      systemImageName: "paintpalette"
    )
    AppShortcut(
      intent: ApplyLightPresetIntent(),
      phrases: [
        "\(.applicationName) \(\.$preset)",
        "\(.applicationName) preset \(\.$preset)",
      ],
      shortTitle: "Apply Preset",
      systemImageName: "square.grid.2x2"
    )
    AppShortcut(
      intent: SetLightModeIntent(),
      phrases: [
        "\(.applicationName) \(\.$mode)",
        "\(.applicationName) mode \(\.$mode)",
      ],
      shortTitle: "Set Mode",
      systemImageName: "waveform"
    )
    AppShortcut(
      intent: SetLightPowerIntent(),
      phrases: [
        "\(.applicationName) \(\.$state)",
        "Turn \(\.$state) \(.applicationName)",
      ],
      shortTitle: "Power",
      systemImageName: "power"
    )
  }
}
