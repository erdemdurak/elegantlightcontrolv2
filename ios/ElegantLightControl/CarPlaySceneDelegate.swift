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

    // Without this a tap did nothing until the phone was woken. CarPlay having a scene is not
    // enough to keep the app out of suspension, and a suspended app has no JS runtime — so the
    // command sat in UserDefaults until something happened to resume the app. Holding the
    // silent audio session for as long as CarPlay is connected keeps JS alive to answer.
    BackgroundKeepAlive.shared.begin()
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    self.interfaceController = nil
    BackgroundKeepAlive.shared.end()
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

    return CPTabBarTemplate(templates: [presets, control])
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

  private static func dispatch(_ payload: [String: String]) {
    PendingCommand.write(payload)
    NotificationCenter.default.post(
      name: CarPlaySceneDelegate.commandNotification,
      object: nil,
      userInfo: payload
    )
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
