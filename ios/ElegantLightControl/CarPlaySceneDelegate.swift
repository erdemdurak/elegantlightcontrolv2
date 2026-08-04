import CarPlay
import Foundation
import UIKit

/**
 The CarPlay app.

 Apple granted the **Driving Task** entitlement on 2026-08-04, which allows CPListTemplate,
 CPGridTemplate, CPInformationTemplate, CPTabBarTemplate, CPAlertTemplate and
 CPActionSheetTemplate, to a maximum depth of five templates. A flat list of presets fits that
 comfortably and is the safest thing to offer a driver: every row is one tap, applies
 immediately, and needs no reading.

 Handover to the app reuses the Siri path — `PendingCommand` in UserDefaults, drained by JS —
 because it is already proven and because CarPlay can launch the app straight into the
 background, where there may be no JS runtime yet. A notification is posted as well so a
 running app reacts at once instead of waiting for a foreground event; see CarPlayBridge.m.

 Marked iOS 16 because it reads the preset list from `LightPresetOption`, which is an AppEnum.
 Keeping one list rather than a third copy is worth more than iOS 15 support on a personal app.
 */
@available(iOS 16.0, *)
class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  static let commandNotification = Notification.Name("ElegantLightCarPlayCommand")

  private var interfaceController: CPInterfaceController?

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    interfaceController.setRootTemplate(Self.makeRootTemplate(), animated: false, completion: nil)
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    self.interfaceController = nil
  }

  private static func makeRootTemplate() -> CPListTemplate {
    let presets = LightPresetOption.allCases.map { option in
      row(title: option.displayName) { ["type": "preset", "value": option.rawValue] }
    }

    let power = [
      row(title: "Lights On") { ["type": "power", "value": "on"] },
      row(title: "Lights Off") { ["type": "power", "value": "off"] },
    ]

    let template = CPListTemplate(
      title: "Elegant Light",
      sections: [
        CPListSection(items: presets, header: "Presets", sectionIndexTitle: nil),
        CPListSection(items: power, header: "Power", sectionIndexTitle: nil),
      ]
    )

    return template
  }

  /// A row that fires its command and completes straight away — no confirmation step, because
  /// a driver should never be left holding a half-finished interaction.
  private static func row(
    title: String,
    command: @escaping () -> [String: String]
  ) -> CPListItem {
    let item = CPListItem(text: title, detailText: nil)

    item.handler = { _, completion in
      let payload = command()
      PendingCommand.write(payload)
      NotificationCenter.default.post(
        name: CarPlaySceneDelegate.commandNotification,
        object: nil,
        userInfo: payload
      )
      completion()
    }

    return item
  }
}
