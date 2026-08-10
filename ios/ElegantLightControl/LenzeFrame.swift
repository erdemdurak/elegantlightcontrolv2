import Foundation

/**
 Lenze 55/AA frames, ported from `src/ble/protocolFamilies.ts`.

 Captured 2026-07-31 from the vendor iOS app (ShenZhen Lenze Technology) driving this exact
 controller, via a PacketLogger HCI trace — observed on the wire, not inferred.

     55 | LEN | CMD | payload... | CKSUM | AA

     LEN   = byte count of CMD + payload
     CKSUM = ~(LEN + CMD + payload) & 0xFF

 Sent to FFB1 as write-without-response.

 **Both areas travel in every frame.** There is no area-selector byte, which is why a writer
 that does not remember the other area will visibly reset it. That is the whole reason this
 type holds state rather than being a pile of pure functions — see `LenzeState`.

 This duplicates the TypeScript. It has to: the point of the native path is to work when no
 JS runtime is alive. Any protocol change must be made in both places, and the two are kept
 deliberately line-for-line comparable so a diff is easy to eyeball.
 */
enum LenzeFrame {
  static let header: UInt8 = 0x55
  static let tail: UInt8 = 0xAA

  enum Command: UInt8 {
    case queryState = 0x00
    case queryInfo = 0x01
    case brightness = 0x02
    case mode = 0x03
    case colour = 0x04
    case power = 0x05
    case speed = 0x23
  }

  /// Mirrors HARDWARE_MODES in protocolFamilies.ts.
  enum HardwareMode: UInt8 {
    case `static` = 0x00
    case gradient = 0x01
    case breathe = 0x02
    case strobe = 0x03
    case automatic = 0x04
  }

  /// `55 LEN CMD payload CKSUM AA`, with LEN counting CMD plus payload.
  static func build(_ command: Command, _ payload: [UInt8] = []) -> [UInt8] {
    let body: [UInt8] = [UInt8(1 + payload.count), command.rawValue] + payload
    let sum = body.reduce(0) { ($0 &+ Int($1)) & 0xFF }
    let checksum = UInt8(~sum & 0xFF)
    return [header] + body + [checksum, tail]
  }
}

/// A colour as the controller wants it: three bytes, no alpha, no colour space.
struct LenzeRgb: Equatable {
  var r: UInt8
  var g: UInt8
  var b: UInt8

  /// Accepts `#RRGGBB` or `RRGGBB`. Returns nil rather than guessing at anything else.
  init?(hex: String) {
    var s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    s = s.uppercased()
    guard s.count == 6, let value = UInt32(s, radix: 16) else {
      return nil
    }
    r = UInt8((value >> 16) & 0xFF)
    g = UInt8((value >> 8) & 0xFF)
    b = UInt8(value & 0xFF)
  }

  init(r: UInt8, g: UInt8, b: UInt8) {
    self.r = r
    self.g = g
    self.b = b
  }
}

/**
 The controller's state as far as we know it, because every frame must carry both areas.

 On a cold start these default to white and 100%, exactly as the TypeScript does. The UI
 seeds the real values on launch and on connect (`seedLenzeAreas` / `seedLenzeBrightness`
 there, `seed(...)` here) so the first single-area change after reopening does not reset the
 other half.
 */
final class LenzeState {
  private(set) var colour: [LenzeRgb] = [LenzeRgb(r: 255, g: 255, b: 255),
                                         LenzeRgb(r: 255, g: 255, b: 255)]
  private(set) var brightness: [UInt8] = [100, 100]
  private(set) var mode: [LenzeFrame.HardwareMode] = [.static, .static]

  /// Area is 1 or 2 everywhere in this project; nil means both.
  private func indices(_ area: Int?) -> [Int] {
    guard let area, area == 1 || area == 2 else {
      return [0, 1]
    }
    return [area - 1]
  }

  func seed(area1: LenzeRgb, area2: LenzeRgb, brightness1: UInt8, brightness2: UInt8) {
    colour = [area1, area2]
    brightness = [min(brightness1, 100), min(brightness2, 100)]
  }

  func colourFrame(_ rgb: LenzeRgb, area: Int? = nil) -> [UInt8] {
    for i in indices(area) {
      colour[i] = rgb
    }
    return LenzeFrame.build(.colour, [colour[0].r, colour[0].g, colour[0].b,
                                      colour[1].r, colour[1].g, colour[1].b])
  }

  /// 0-100, dead linear — the controller applies no gamma curve.
  func brightnessFrame(_ percent: Int, area: Int? = nil) -> [UInt8] {
    let clamped = UInt8(max(0, min(100, percent)))
    for i in indices(area) {
      brightness[i] = clamped
    }
    return LenzeFrame.build(.brightness, [brightness[0], brightness[1]])
  }

  func modeFrame(_ value: LenzeFrame.HardwareMode, area: Int? = nil) -> [UInt8] {
    for i in indices(area) {
      mode[i] = value
    }
    return LenzeFrame.build(.mode, [mode[0].rawValue, mode[1].rawValue])
  }

  func powerFrame(on: Bool) -> [UInt8] {
    LenzeFrame.build(.power, [on ? 0x01 : 0x00])
  }

  func speedFrame(_ value: Int) -> [UInt8] {
    LenzeFrame.build(.speed, [UInt8(max(1, min(5, value)))])
  }

  /**
   What the vendor app sends before setting a colour: ask for state, then force both areas
   back to static.

   Without the mode reset, a controller left running a hardware effect blends over our colour
   writes — the likeliest cause of colours coming out washed next to the vendor app's.
   */
  func preamble() -> [[UInt8]] {
    [LenzeFrame.build(.queryState), modeFrame(.static)]
  }
}
