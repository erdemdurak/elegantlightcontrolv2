import { NativeModules, Platform } from "react-native";

/**
 * The native CoreBluetooth writer — see ios/ElegantLightControl/AmbientBle.swift.
 *
 * It exists so CarPlay and Siri can drive the lights with no JS runtime alive, which is what
 * broke when `UIBackgroundModes -> audio` was removed for App Store guideline 2.5.4.
 *
 * JS still owns the radio whenever the app is actually running. The two must never write at
 * once: every Lenze frame carries *both* areas, so interleaved writes would visibly reset the
 * zone that was not being edited. `setSuppressed(true)` is how JS claims ownership.
 *
 * iOS only. There is no native module on Android, so every call is a no-op rather than a crash.
 */
const native = NativeModules.AmbientBle as
  | {
      publishDeviceId(deviceId: string): void;
      setSuppressed(suppressed: boolean): void;
      seedState(area1Hex: string, area2Hex: string, brightness1: number, brightness2: number): void;
    }
  | undefined;

export function isNativeBleAvailable(): boolean {
  return Platform.OS === "ios" && Boolean(native);
}

/**
 * Mirror the controller's identifier into UserDefaults.
 *
 * JS keeps it in AsyncStorage, which needs a JS runtime to read — precisely what the native
 * path does not have on a cold background launch.
 */
export function publishDeviceId(deviceId: string): void {
  native?.publishDeviceId?.(deviceId);
}

/** True while JS holds the connection. Native drops any frames it is handed meanwhile. */
export function setNativeSuppressed(suppressed: boolean): void {
  native?.setSuppressed?.(suppressed);
}

/**
 * Hand the current colours and brightness to the native side.
 *
 * Without this its memory starts at white/100%, and the first CarPlay tap that changes one
 * area would reset the other — the same cold-start problem `seedLenzeAreas` solves in JS.
 */
export function seedNativeState(
  area1Hex: string,
  area2Hex: string,
  brightness1: number,
  brightness2: number,
): void {
  native?.seedState?.(area1Hex, area2Hex, brightness1, brightness2);
}
