import { NativeEventEmitter, NativeModules } from "react-native";

/**
 * Commands handed over by the App Intents in ios/ElegantLightControl/AmbientIntents.swift.
 *
 * Siri cold-launches the app to run the BLE write, so there is no JS runtime alive when the
 * intent fires. The intent parks a JSON blob in UserDefaults and the app drains it once it is
 * running — on mount and every time it returns to the foreground.
 */
export type SiriArea = "area1" | "area2" | "both";

export type SiriCommand =
  | { type: "color"; value: string; area: SiriArea }
  | { type: "brightness"; value: string; area: SiriArea }
  | { type: "mode"; value: string; area: SiriArea }
  | { type: "preset"; value: string }
  | { type: "power"; value: "on" | "off" };

const native = NativeModules.SiriBridge as
  | { consumePendingCommand(): Promise<string | null> }
  | undefined;

/** Reads and clears the pending command. Null when there is nothing waiting. */
export async function consumeSiriCommand(): Promise<SiriCommand | null> {
  if (!native) {
    return null;
  }

  try {
    const raw = await native.consumePendingCommand();
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as SiriCommand;
    return parsed?.type ? parsed : null;
  } catch {
    // A malformed blob must never stop the app starting — it has already been cleared.
    return null;
  }
}

/**
 * Fires when a CarPlay row is tapped. The command itself still comes from
 * `consumeSiriCommand` — this only says "there is one waiting, now".
 *
 * CarPlay can leave the app in the background indefinitely, so waiting for a foreground event
 * to drain the queue would mean the lights changed minutes later, or not at all.
 */
export function onCarPlayCommand(listener: () => void): () => void {
  const native = NativeModules.CarPlayBridge;
  if (!native) {
    return () => undefined;
  }

  const emitter = new NativeEventEmitter(native);
  const subscription = emitter.addListener("carPlayCommand", listener);

  return () => subscription.remove();
}

/**
 * Hand the preset list to the CarPlay screen.
 *
 * CarPlay is native and cannot read `src/themes.ts`. The presets and their colours have been
 * revised repeatedly, so a Swift copy would go stale — publishing them keeps one source of
 * truth and lets the car draw the real colours.
 */
export function publishPresets(
  presets: Array<{
    id: string;
    name: string;
    area1: string;
    area2: string;
    /** Per-area brightness, so the native writer can apply a preset in full — see AmbientBle. */
    brightness1: number;
    brightness2: number;
  }>,
): void {
  const native = NativeModules.CarPlayBridge as { publishPresets?(json: string): void } | undefined;
  native?.publishPresets?.(JSON.stringify(presets));
}
