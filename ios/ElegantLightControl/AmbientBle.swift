import CoreBluetooth
import Foundation

/**
 A native CoreBluetooth writer for the lighting controller.

 **Why this exists.** Everything used to go through `react-native-ble-plx`, which means every
 command needed a live JS runtime. iOS suspends a backgrounded app, a suspended app has no JS,
 and so a CarPlay tap with the phone asleep did nothing until something happened to resume the
 app. That was papered over by holding a silent audio session, which App Store guideline 2.5.4
 forbids. This is the real fix: CarPlay and Siri write frames from Swift, no JS involved.

 **What it deliberately does not do.** It cannot make gradient or strobe run in the background.
 Those need a timer firing every 110-190 ms while suspended, and `bluetooth-central` grants
 event-driven wake-ups, not a clock. No amount of native code changes that — the constraint is
 iOS, not the language.

 **Connection ownership.** Two CBCentralManagers in one process can both connect to the same
 peripheral, and since every Lenze frame carries *both* areas, interleaved writes from two
 writers would visibly reset the zone that was not being edited. While JS is driving, this
 class stays out of the way — see `isSuppressed`.
 */
@objc(AmbientBle)
final class AmbientBle: NSObject {
  @objc static let shared = AmbientBle()

  /// Matches CONTROL_SERVICE_PREFIX / the write characteristic in bleAmbientController.ts.
  private static let serviceUuid = CBUUID(string: "FFB0")
  private static let writeUuid = CBUUID(string: "FFB1")

  /// Same pacing as WRITE_GAP_MS in bleAmbientController.ts. The original code blasted ~190
  /// unpaced writes per action and that alone prevented control; do not lower this casually.
  private static let writeGap: TimeInterval = 0.040

  /// Lets iOS relaunch us into the background to finish a connection.
  private static let restoreId = "com.ambientlightcontroller.mobile.central"

  /// Published by JS on connect — see publishDeviceId in the bridge.
  private static let deviceIdKey = "lastDeviceId"
  private static let presetsKey = "carPlayPresets"

  /**
   Created on first use, not in `init`.

   React Native instantiates the bridge module itself, so a second AmbientBle exists purely to
   receive calls from JS. Building a CBCentralManager in `init` would give that throwaway a
   radio of its own — a second central that could connect and write alongside the real one,
   which is exactly the interleaving this class exists to prevent. Only `shared` ever reaches
   the code below, so only `shared` ever builds one.
   */
  private lazy var central: CBCentralManager = CBCentralManager(
    delegate: self,
    queue: DispatchQueue(label: "ambient.ble"),
    options: [CBCentralManagerOptionRestoreIdentifierKey: AmbientBle.restoreId]
  )
  private var peripheral: CBPeripheral?
  private var writeChar: CBCharacteristic?
  private let state = LenzeState()

  /// Frames waiting for a usable connection. Bounded so a controller that never connects
  /// cannot grow this without limit while taps keep arriving.
  private var queue: [[UInt8]] = []
  private static let maxQueued = 64

  private var draining = false
  private let lock = NSLock()

  /// True while the JS side owns the radio. Set by the bridge when the app is foregrounded.
  private var isSuppressed = false

  /// Not private: React Native allocates its own instance for the bridge. That instance owns
  /// no radio and no state — every @objc method below forwards to `shared`.
  override init() {
    super.init()
  }

  // MARK: - Public API

  /// React Native instantiates the bridge module itself; the radio lives on `shared`.
  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  /**
   Remember which controller to reconnect to.

   JS keeps this in AsyncStorage, which is unreachable without a JS runtime — and the whole
   point of this class is to work when there is none. UserDefaults is readable from a cold
   background launch, so the id is mirrored there.
   */
  // Every method below is called on React Native's throwaway instance, so each forwards to
  // `shared`. Mutating `self` here would set the flag on an object nothing else can see —
  // suppression would appear to work and quietly never apply. Same shape as
  // BackgroundKeepAlive's start/stop.

  @objc func publishDeviceId(_ deviceId: String) {
    // No instance state, but kept here for symmetry with the rest of the bridge surface.
    UserDefaults.standard.set(deviceId, forKey: AmbientBle.deviceIdKey)
  }

  @objc func setSuppressed(_ suppressed: Bool) {
    AmbientBle.shared.applySuppressed(suppressed)
  }

  /// Seed the remembered colours so a single-area change does not reset the other half.
  @objc(seedState:area2Hex:brightness1:brightness2:)
  func seedState(_ area1Hex: String, area2Hex: String, brightness1: Int, brightness2: Int) {
    AmbientBle.shared.applySeed(area1Hex: area1Hex, area2Hex: area2Hex,
                                brightness1: brightness1, brightness2: brightness2)
  }

  // MARK: - Singleton-side implementations

  private func applySuppressed(_ suppressed: Bool) {
    lock.lock()
    isSuppressed = suppressed
    lock.unlock()
  }

  private func applySeed(area1Hex: String, area2Hex: String, brightness1: Int, brightness2: Int) {
    guard let a1 = LenzeRgb(hex: area1Hex), let a2 = LenzeRgb(hex: area2Hex) else {
      NSLog("AmbientBle: ignoring seed with bad hex \(area1Hex) / \(area2Hex)")
      return
    }
    state.seed(area1: a1, area2: a2,
               brightness1: UInt8(max(0, min(100, brightness1))),
               brightness2: UInt8(max(0, min(100, brightness2))))
  }

  /// Apply a preset by id, reading colours from the same UserDefaults blob CarPlay draws.
  @objc @discardableResult
  func applyPreset(id: String) -> Bool {
    guard let preset = AmbientBle.preset(id: id),
          let a1 = LenzeRgb(hex: preset.area1),
          let a2 = LenzeRgb(hex: preset.area2) else {
      NSLog("AmbientBle: preset \(id) not found or has bad colours")
      return false
    }

    // Only the mode reset, not the full preamble: the connection handshake is sent once in
    // didDiscoverCharacteristicsFor. This is here because a controller left running a
    // hardware effect blends over colour writes.
    var frames = [state.modeFrame(.static)]
    _ = state.colourFrame(a1, area: 1)
    frames.append(state.colourFrame(a2, area: 2))
    if let b1 = preset.brightness1, let b2 = preset.brightness2 {
      _ = state.brightnessFrame(b1, area: 1)
      frames.append(state.brightnessFrame(b2, area: 2))
    }
    enqueue(frames)
    return true
  }

  @objc func applyColour(hex: String, area: Int) {
    guard let rgb = LenzeRgb(hex: hex) else {
      return
    }
    enqueue([state.modeFrame(.static), state.colourFrame(rgb, area: area == 0 ? nil : area)])
  }

  @objc func applyBrightness(_ percent: Int, area: Int) {
    enqueue([state.brightnessFrame(percent, area: area == 0 ? nil : area)])
  }

  @objc func applyPower(on: Bool) {
    enqueue([state.powerFrame(on: on)])
  }

  // MARK: - Presets

  struct Preset {
    let id: String
    let name: String
    let area1: String
    let area2: String
    let brightness1: Int?
    let brightness2: Int?
  }

  /// JS owns src/themes.ts and publishes it here, so there is no Swift copy to go stale.
  static func preset(id: String) -> Preset? {
    guard let json = UserDefaults.standard.string(forKey: presetsKey),
          let data = json.data(using: .utf8),
          let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
      return nil
    }
    guard let row = rows.first(where: { $0["id"] as? String == id }) else {
      return nil
    }
    guard let a1 = row["area1"] as? String, let a2 = row["area2"] as? String else {
      return nil
    }
    return Preset(id: id, name: row["name"] as? String ?? id, area1: a1, area2: a2,
                  brightness1: row["brightness1"] as? Int, brightness2: row["brightness2"] as? Int)
  }

  // MARK: - Queue

  private func enqueue(_ frames: [[UInt8]]) {
    lock.lock()
    // Dropped rather than queued while JS owns the radio: JS is applying this same command
    // from UserDefaults, so holding the frames would only replay a stale colour later, after
    // the user had moved on.
    if isSuppressed {
      lock.unlock()
      return
    }
    queue.append(contentsOf: frames)
    if queue.count > AmbientBle.maxQueued {
      queue.removeFirst(queue.count - AmbientBle.maxQueued)
    }
    lock.unlock()
    connectIfNeeded()
    drain()
  }

  private func drain() {
    lock.lock()
    let suppressed = isSuppressed
    let busy = draining
    let ready = writeChar != nil && peripheral?.state == .connected
    if suppressed || busy || !ready || queue.isEmpty {
      lock.unlock()
      return
    }
    draining = true
    lock.unlock()

    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self else { return }
      while true {
        self.lock.lock()
        let stop = self.isSuppressed || self.queue.isEmpty
            || self.writeChar == nil || self.peripheral?.state != .connected
        let frame = stop ? nil : self.queue.removeFirst()
        if stop { self.draining = false }
        self.lock.unlock()

        guard let frame, let p = self.peripheral, let c = self.writeChar else { return }
        p.writeValue(Data(frame), for: c, type: .withoutResponse)
        Thread.sleep(forTimeInterval: AmbientBle.writeGap)
      }
    }
  }

  // MARK: - Connection

  private func connectIfNeeded() {
    guard central.state == .poweredOn else {
      return
    }
    if let p = peripheral, p.state == .connected || p.state == .connecting {
      return
    }
    guard let idString = UserDefaults.standard.string(forKey: AmbientBle.deviceIdKey),
          let uuid = UUID(uuidString: idString) else {
      NSLog("AmbientBle: no remembered controller to connect to")
      return
    }
    // Reconnecting by identifier needs no scan, which matters because scanning in the
    // background is heavily restricted and slow.
    guard let known = central.retrievePeripherals(withIdentifiers: [uuid]).first else {
      NSLog("AmbientBle: controller \(idString) not known to CoreBluetooth")
      return
    }
    peripheral = known
    known.delegate = self
    central.connect(known, options: nil)
  }
}

extension AmbientBle: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state == .poweredOn {
      connectIfNeeded()
    }
  }

  /// Required when a restore identifier is set — iOS may relaunch us holding a connection.
  func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
    if let restored = (dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral])?.first {
      peripheral = restored
      restored.delegate = self
    }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([AmbientBle.serviceUuid])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral,
                      error: Error?) {
    NSLog("AmbientBle: connect failed — \(error?.localizedDescription ?? "unknown")")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
                      error: Error?) {
    lock.lock()
    writeChar = nil
    lock.unlock()
    // Only chase the connection while there is something to send, so a disconnect with an
    // empty queue does not keep the radio busy for nothing.
    if !queue.isEmpty {
      connectIfNeeded()
    }
  }
}

extension AmbientBle: CBPeripheralDelegate {
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let service = peripheral.services?.first(where: { $0.uuid == AmbientBle.serviceUuid })
    else {
      NSLog("AmbientBle: control service FFB0 not found")
      return
    }
    peripheral.discoverCharacteristics([AmbientBle.writeUuid], for: service)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
                  error: Error?) {
    guard let c = service.characteristics?.first(where: { $0.uuid == AmbientBle.writeUuid }) else {
      NSLog("AmbientBle: write characteristic FFB1 not found")
      return
    }
    lock.lock()
    writeChar = c
    // The handshake belongs to the connection, not to the command.
    //
    // Confirmed in the car 2026-08-11: with the phone locked, CarPlay presets worked and
    // CarPlay brightness did nothing. Presets happened to carry `preamble()` themselves;
    // brightness and power sent a bare frame, and the controller ignored it on a
    // freshly-opened link. Sending it here means every command gets the handshake exactly
    // once, whichever one arrives first.
    queue.insert(contentsOf: state.preamble(), at: 0)
    lock.unlock()
    drain()
  }
}
