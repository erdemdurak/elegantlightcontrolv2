import AVFoundation
import Foundation

/**
 Keeps the app running while a phone-driven effect is playing.

 `effectEngine` computes every animation frame on the phone and writes it over BLE roughly
 every 110-190 ms. iOS suspends a backgrounded app, and a suspended app has no timer, so
 gradient and strobe die the moment you leave the app. `bluetooth-central` does not help —
 it grants event-driven wake-ups, not a clock.

 Holding an active audio session does. iOS treats an app that is playing audio as alive, so
 the JS timer keeps firing with the screen off. We play silence: a one-second buffer of zeroes
 generated in memory, looped forever. Nothing is shipped as an asset and nothing is audible.

 Two things here are not optional:

 - **`.mixWithOthers`.** Without it, activating a playback session stops whatever the car is
   already playing. An ambient-light app that kills your music the moment an effect starts is
   an app you would never turn on.
 - **Interruption handling.** A phone call deactivates the session. Without the observer below
   the silence never resumes, the app is suspended at the next opportunity, and the effect
   stops for good with nothing on screen to explain why.

 Start it only while an effect is actually running — see `isPhoneDrivenMode` in App.tsx. The
 app never sleeping is a real battery cost and must not be paid for a static colour.
 */
@objc(BackgroundKeepAlive)
class BackgroundKeepAlive: NSObject {
  private var player: AVAudioPlayer?
  private var observing = false

  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc func start() {
    guard player == nil else {
      return
    }

    let session = AVAudioSession.sharedInstance()

    do {
      try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
      try session.setActive(true)

      let player = try AVAudioPlayer(data: BackgroundKeepAlive.silentWav())
      player.numberOfLoops = -1
      player.volume = 0
      player.prepareToPlay()
      player.play()
      self.player = player

      observeInterruptions()
    } catch {
      NSLog("BackgroundKeepAlive: could not start — \(error.localizedDescription)")
      player = nil
    }
  }

  @objc func stop() {
    player?.stop()
    player = nil

    if observing {
      NotificationCenter.default.removeObserver(self)
      observing = false
    }

    // Leaving the session active would keep other apps' audio ducked around ours for no
    // reason. `notifyOthersOnDeactivation` hands the route back cleanly.
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }

  private func observeInterruptions() {
    guard !observing else {
      return
    }

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: nil
    )
    // Media services can be reset out from under us; the player is invalid afterwards.
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleReset(_:)),
      name: AVAudioSession.mediaServicesWereResetNotification,
      object: nil
    )
    observing = true
  }

  @objc private func handleInterruption(_ note: Notification) {
    guard
      let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: raw)
    else {
      return
    }

    guard type == .ended else {
      return
    }

    try? AVAudioSession.sharedInstance().setActive(true)
    player?.play()
  }

  @objc private func handleReset(_ note: Notification) {
    guard player != nil else {
      return
    }

    stop()
    start()
  }

  /// A one-second silent 8 kHz mono PCM WAV, built in memory so no audio file has to ship.
  private static func silentWav(seconds: Int = 1, sampleRate: Int = 8000) -> Data {
    let channels = 1
    let bitsPerSample = 16
    let blockAlign = channels * bitsPerSample / 8
    let byteRate = sampleRate * blockAlign
    let dataSize = byteRate * seconds

    var out = Data()
    func ascii(_ s: String) { out.append(s.data(using: .ascii)!) }
    func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { out.append(contentsOf: $0) } }

    ascii("RIFF"); u32(UInt32(36 + dataSize)); ascii("WAVE")
    ascii("fmt "); u32(16); u16(1); u16(UInt16(channels)); u32(UInt32(sampleRate))
    u32(UInt32(byteRate)); u16(UInt16(blockAlign)); u16(UInt16(bitsPerSample))
    ascii("data"); u32(UInt32(dataSize))
    out.append(Data(count: dataSize))

    return out
  }
}
