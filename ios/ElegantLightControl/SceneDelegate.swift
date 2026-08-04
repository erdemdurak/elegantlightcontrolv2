import UIKit

/**
 The phone window, under the scene lifecycle.

 Adopting scenes is only necessary because CarPlay requires a scene manifest, and once one
 exists UIKit stops displaying a window the app delegate made for itself — which is exactly how
 this app went blank twice: it launched, React Native started, and nothing was ever attached to
 the screen.

 The root view controller is built in `AppDelegate` so that JS is running even when CarPlay
 launches the app without a phone window. This takes that controller and puts it on a window
 belonging to the real scene.
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }

    let window = UIWindow(windowScene: windowScene)

    // Re-parent rather than build a second React root: two roots would mean two mounted copies
    // of the app, both writing to the same controller over BLE.
    if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
      window.rootViewController = appDelegate.window?.rootViewController
    }

    self.window = window
    window.makeKeyAndVisible()
  }
}
