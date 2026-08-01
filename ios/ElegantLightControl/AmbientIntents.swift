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

/// Hexes kept in step with `presetColors` in App.tsx — every one fully saturated.
@available(iOS 16.0, *)
enum LightColorOption: String, AppEnum {
  case red, orange, amber, yellow, lime, green, cyan, azure, blue, violet, magenta, pink
  case white, warmWhite

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Colour")
  static var caseDisplayRepresentations: [LightColorOption: DisplayRepresentation] = [
    .red: "red",
    .orange: "orange",
    .amber: "amber",
    .yellow: "yellow",
    .lime: "lime",
    .green: "green",
    .cyan: "cyan",
    .azure: "azure",
    .blue: "blue",
    .violet: "violet",
    .magenta: "magenta",
    .pink: "pink",
    .white: "white",
    .warmWhite: "warm white",
  ]

  var hex: String {
    switch self {
    case .red: return "#FF0000"
    case .orange: return "#FF8000"
    case .amber: return "#FFBF00"
    case .yellow: return "#FFFF00"
    case .lime: return "#80FF00"
    case .green: return "#00FF00"
    case .cyan: return "#00FFFF"
    case .azure: return "#0080FF"
    case .blue: return "#0000FF"
    case .violet: return "#8000FF"
    case .magenta: return "#FF00FF"
    case .pink: return "#FF0080"
    case .white: return "#FFFFFF"
    case .warmWhite: return "#FFB870"
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
  case amethyst
  case ultraviolet
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
    .emerald: "Emerald",
    .nightshade: "Nightshade",
    .amethyst: "Amethyst",
    .ultraviolet: "Ultraviolet",
    .alpine: "Alpine",
  ]
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

/// Phrases must contain `\(.applicationName)`, so every one names the app somewhere.
@available(iOS 16.0, *)
struct AmbientShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SetLightColorIntent(),
      // One parameter per phrase is a hard limit of AppShortcuts, so area cannot be spoken
      // here. It stays a parameter on the intent itself, settable in the Shortcuts app.
      phrases: [
        "Set \(.applicationName) to \(\.$color)",
        "\(.applicationName) \(\.$color)",
      ],
      shortTitle: "Set Colour",
      systemImageName: "paintpalette"
    )
    AppShortcut(
      intent: ApplyLightPresetIntent(),
      phrases: [
        "Apply \(\.$preset) in \(.applicationName)",
        "\(.applicationName) \(\.$preset)",
      ],
      shortTitle: "Apply Preset",
      systemImageName: "square.grid.2x2"
    )
    AppShortcut(
      intent: SetLightPowerIntent(),
      phrases: ["Turn \(\.$state) \(.applicationName)"],
      shortTitle: "Power",
      systemImageName: "power"
    )
  }
}
