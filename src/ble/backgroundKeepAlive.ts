import { NativeModules, Platform } from "react-native";

/**
 * Keeps the app alive while a phone-driven effect is running, so gradient and strobe survive
 * the screen locking. See ios/ElegantLightControl/BackgroundKeepAlive.swift for how and why.
 *
 * iOS only. Android is scaffolded but unconfigured, and there is no native module there, so
 * every call is a no-op rather than a crash.
 */
const native = NativeModules.BackgroundKeepAlive as
  | { start(): void; stop(): void }
  | undefined;

export function isKeepAliveAvailable(): boolean {
  return Platform.OS === "ios" && Boolean(native);
}

/** Idempotent — the native side ignores a second start. */
export function startKeepAlive(): void {
  native?.start();
}

export function stopKeepAlive(): void {
  native?.stop();
}
