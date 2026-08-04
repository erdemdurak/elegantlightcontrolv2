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

  /**
   The cabin, drawn small, with the preset's colours where they actually fall.

   CarPlay caps list images at 44 points. A photograph of the interior at that size is an
   unreadable smudge, so this is a stylised version instead: two vent rings across the top in
   the Area 2 colour, and the door line sweeping below them in Area 1. It carries the same
   information as the photo — which colour lands where — at a size that still reads.
   */
  private static func swatch(_ preset: Preset) -> UIImage {
    let size = CGSize(width: 44, height: 44)
    let renderer = UIGraphicsImageRenderer(size: size)

    return renderer.image { context in
      let cgContext = context.cgContext
      UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 10).addClip()

      // Cabin dark, so the light colours read as light rather than as fill.
      UIColor(red: 0.04, green: 0.05, blue: 0.09, alpha: 1).setFill()
      cgContext.fill(CGRect(origin: .zero, size: size))

      let vents = color(preset.area2)
      let doors = color(preset.area1)

      // Two turbine vents, upper third.
      vents.setStroke()
      for centre in [CGPoint(x: 14, y: 15), CGPoint(x: 30, y: 15)] {
        let ring = UIBezierPath(
          arcCenter: centre, radius: 5, startAngle: 0, endAngle: .pi * 2, clockwise: true
        )
        ring.lineWidth = 2.5
        ring.stroke()
      }

      // The door line, sweeping across the lower half the way the fibre run does.
      let line = UIBezierPath()
      line.move(to: CGPoint(x: 4, y: 33))
      line.addCurve(
        to: CGPoint(x: 40, y: 33),
        controlPoint1: CGPoint(x: 16, y: 26),
        controlPoint2: CGPoint(x: 28, y: 26)
      )
      line.lineWidth = 3
      line.lineCapStyle = .round
      doors.setStroke()
      line.stroke()
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
