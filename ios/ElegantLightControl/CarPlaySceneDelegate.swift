import CarPlay
import Foundation
import UIKit

/**
 The CarPlay app.

 Shaped for someone driving, not for feature parity with the phone. Everything reachable in
 one tap, the first screen a grid rather than a list — big targets, no scrolling, no reading a
 column of text at speed — and a brightness row, because with a sleeping passenger the thing
 you want is *dimmer*, which otherwise needs the phone or your voice.

 Presets come from `carPlayPresets` in UserDefaults, published by JS. They change often and a
 Swift copy would go stale; this way the source of truth stays in src/themes.ts.

 Handover reuses the Siri path — a command in UserDefaults, drained by JS — because CarPlay can
 launch the app straight into the background where there is no JS runtime yet. A notification
 goes out too so a running app reacts immediately; see CarPlayBridge.m.
 */
@available(iOS 16.0, *)
class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  static let commandNotification = Notification.Name("ElegantLightCarPlayCommand")

  private var interfaceController: CPInterfaceController?

  private struct Preset: Decodable {
    let id: String
    let name: String
    let area1: String
    let area2: String
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    interfaceController.setRootTemplate(makeRootTemplate(), animated: false, completion: nil)

    // A known limitation, accepted deliberately: if iOS suspends the app, a tap here lands in
    // UserDefaults and does nothing until something resumes the app. CarPlay having a scene is
    // not enough to keep the app out of suspension, and a suspended app has no JS runtime.
    //
    // This used to be solved by holding a silent audio session for as long as CarPlay was
    // connected. That needs `audio` in UIBackgroundModes, which App Store guideline 2.5.4
    // forbids for this purpose. The correct fix is to write the frame from Swift over
    // CoreBluetooth so no JS runtime is needed at all — Task 1c.
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    self.interfaceController = nil
  }

  // MARK: - Templates

  private func makeRootTemplate() -> CPTemplate {
    // A list rather than a grid, because CarPlay renders CPGridButton artwork as a *template*
    // — it tints it flat, so two-tone swatches came out monochrome and the tiles were
    // distinguishable only by name. CPListItem images are drawn as-is, which is how audio apps
    // show album art, so the real colours survive here.
    let rows = Self.loadPresets().map { preset in
      let item = CPListItem(
        text: preset.name,
        detailText: "\(preset.area1)   \(preset.area2)",
        image: Self.swatch(preset)
      )
      item.handler = { _, completion in
        Self.dispatch(["type": "preset", "value": preset.id])
        completion()
      }
      return item
    }

    let presets = CPListTemplate(
      title: "Presets",
      sections: [CPListSection(items: rows, header: nil, sectionIndexTitle: nil)]
    )
    presets.tabTitle = "Presets"
    presets.tabImage = UIImage(systemName: "paintpalette")

    let control = CPListTemplate(title: "Control", sections: Self.controlSections())
    control.tabTitle = "Control"
    control.tabImage = UIImage(systemName: "slider.horizontal.3")

    let voice = makeVoiceTemplate()
    voice.tabTitle = "Voice"
    voice.tabImage = UIImage(systemName: "mic")

    return CPTabBarTemplate(templates: [presets, control, voice])
  }

  // MARK: - Voice commands

  /**
   What you can say, because the phrases are invisible otherwise — nothing in the car or on the
   phone lists them, and a phrase you cannot remember is a phrase you will not use.

   Read-only: no row here changes the lights. The four categories each open the full vocabulary
   rather than showing it inline, so the first screen stays four short lines. Reading a column of
   21 colour names at speed is exactly what this screen must not ask for.
   */
  private func makeVoiceTemplate() -> CPListTemplate {
    let name = Self.spokenAppName

    let categories: [(pattern: String, detail: String, screen: String, words: [String])] = [
      (
        "«colour»", "\(LightColorOption.allCases.count) colours — red, teal, warm white…",
        "Colours", LightColorOption.allCases.map(\.spokenName)
      ),
      (
        "«preset»", "\(LightPresetOption.allCases.count) presets — Burmester, Night Drive…",
        "Presets", LightPresetOption.allCases.map(\.displayName)
      ),
      (
        "«mode»", "solid colour, breathe, gradient…",
        "Modes", LightModeOption.allCases.map(\.spokenName)
      ),
      (
        "on / off", "turns the strips off without unpairing",
        "Power", LightPowerOption.allCases.map(\.rawValue)
      ),
    ]

    let rows = categories.map { category in
      let item = CPListItem(text: "\(name) \(category.pattern)", detailText: category.detail)
      item.accessoryType = .disclosureIndicator
      item.handler = { [weak self] _, completion in
        self?.interfaceController?.pushTemplate(
          Self.vocabularyTemplate(title: category.screen, words: category.words),
          animated: true,
          completion: nil
        )
        completion()
      }
      return item
    }

    // No handler: brightness has no spoken phrase at all, so there is nothing to open.
    let brightness = CPListItem(
      text: "Brightness",
      detailText: "No phrase — a number cannot appear in one. Use the Shortcuts app."
    )

    return CPListTemplate(
      title: "Voice",
      sections: [
        CPListSection(items: rows, header: "Say “Hey Siri”, then…", sectionIndexTitle: nil),
        CPListSection(items: [brightness], header: "Not spoken", sectionIndexTitle: nil),
      ]
    )
  }

  /// One screen of accepted words, each written out as the whole phrase — a driver glancing at
  /// this should not have to assemble it from a pattern and a list.
  private static func vocabularyTemplate(title: String, words: [String]) -> CPListTemplate {
    // CarPlay drops a template that exceeds the car's row limit, and the colour list is the
    // longest thing in this app by some way. Truncating keeps the screen rather than losing it.
    let items = words.prefix(CPListTemplate.maximumItemCount).map { word in
      CPListItem(text: "\(spokenAppName) \(word)", detailText: nil)
    }

    return CPListTemplate(
      title: title,
      sections: [CPListSection(items: Array(items), header: nil, sectionIndexTitle: nil)]
    )
  }

  /// Read rather than hardcoded: AppShortcut phrases interpolate `applicationName`, which *is*
  /// CFBundleDisplayName, so taking it from the same place means the two cannot drift.
  private static var spokenAppName: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Elegant Light"
  }

  private static func controlSections() -> [CPListSection] {
    let brightness = [
      ("Dim", "20"),
      ("Half", "50"),
      ("Full", "100"),
    ].map { label, value in
      row(title: label) { ["type": "brightness", "value": value, "area": "both"] }
    }

    let power = [
      row(title: "Lights On") { ["type": "power", "value": "on"] },
      row(title: "Lights Off") { ["type": "power", "value": "off"] },
    ]

    return [
      CPListSection(items: brightness, header: "Brightness", sectionIndexTitle: nil),
      CPListSection(items: power, header: "Power", sectionIndexTitle: nil),
    ]
  }

  /// A row that fires and completes at once — a driver should never be left mid-interaction.
  private static func row(
    title: String,
    command: @escaping () -> [String: String]
  ) -> CPListItem {
    let item = CPListItem(text: title, detailText: nil)
    item.handler = { _, completion in
      dispatch(command())
      completion()
    }
    return item
  }

  /**
   Apply the tap natively, and tell JS about it too.

   The native write is what makes a tap work with the phone asleep — it needs no JS runtime.
   The UserDefaults command and the notification are still posted so that a *running* app
   updates its UI to match; AmbientBle drops the frames in that case rather than writing them
   twice. See `isSuppressed` there.
   */
  private static func dispatch(_ payload: [String: String]) {
    applyNatively(payload)

    PendingCommand.write(payload)
    NotificationCenter.default.post(
      name: CarPlaySceneDelegate.commandNotification,
      object: nil,
      userInfo: payload
    )
  }

  private static func applyNatively(_ payload: [String: String]) {
    guard let type = payload["type"] else {
      return
    }

    switch type {
    case "preset":
      if let id = payload["value"] {
        AmbientBle.shared.applyPreset(id: id)
      }
    case "brightness":
      if let value = payload["value"], let percent = Int(value) {
        // "both" is area 0 in the native API, matching how nil means both in LenzeState.
        AmbientBle.shared.applyBrightness(percent, area: Int(payload["area"] ?? "") ?? 0)
      }
    case "power":
      AmbientBle.shared.applyPower(on: payload["value"] != "off")
    default:
      NSLog("CarPlay: no native handler for \(type)")
    }
  }

  // MARK: - Presets

  private static func loadPresets() -> [Preset] {
    guard
      let json = UserDefaults.standard.string(forKey: "carPlayPresets"),
      let data = json.data(using: .utf8),
      let presets = try? JSONDecoder().decode([Preset].self, from: data),
      !presets.isEmpty
    else {
      // The app has not run since install, so nothing has been published yet. Names alone are
      // still enough to drive with.
      return LightPresetOption.allCases.map {
        Preset(id: $0.rawValue, name: $0.displayName, area1: "#FFFFFF", area2: "#FFFFFF")
      }
    }

    return presets
  }

  /// The preset's two colours side by side. A stylised cabin was tried here and read worse at
  /// 44 points — CarPlay's cap for list images — than two flat blocks of colour do.
  private static func swatch(_ preset: Preset) -> UIImage {
    let size = CGSize(width: 44, height: 44)
    let renderer = UIGraphicsImageRenderer(size: size)

    return renderer.image { context in
      UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 10).addClip()

      color(preset.area1).setFill()
      context.fill(CGRect(x: 0, y: 0, width: size.width / 2, height: size.height))
      color(preset.area2).setFill()
      context.fill(CGRect(x: size.width / 2, y: 0, width: size.width / 2, height: size.height))
    }
  }

  private static func color(_ hex: String) -> UIColor {
    var value: UInt64 = 0
    Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&value)

    return UIColor(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1
    )
  }
}
