import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

/**
 React Native still boots here, not in the scene delegate, and deliberately.

 CarPlay needs a scene manifest, and declaring one moves the whole app onto the scene
 lifecycle. The obvious conversion — move `startReactNative` into the window scene delegate —
 breaks the case that matters most: CarPlay can launch this app with **no window scene at
 all**, and JS would then never start, so tapping a row in the car would do nothing until the
 phone app was opened by hand.

 So the bridge is started here, into a window that is never shown. `SceneDelegate` re-parents
 that root view controller onto a real, scene-attached window. Whichever scene connects first
 — phone or car — JS is already running by the time it does.
 */
@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  /// Holds the root view controller. Never made key or visible; see SceneDelegate.
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "ElegantLightControl",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    // The names must match the UISceneConfigurationName values in Info.plist.
    if connectingSceneSession.role == .carTemplateApplication {
      return UISceneConfiguration(name: "CarPlay", sessionRole: connectingSceneSession.role)
    }

    return UISceneConfiguration(name: "Phone", sessionRole: connectingSceneSession.role)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
