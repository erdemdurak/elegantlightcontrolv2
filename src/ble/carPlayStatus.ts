import { NativeModules } from "react-native";

/**
 * Whether the phone is currently plugged into the car.
 *
 * Detected from the audio route — see ios/ElegantLightControl/CarPlayStatus.m. Used to decide
 * when to reconnect on its own and whether to apply the day/night preset: doing either while
 * sitting at a desk would be surprising.
 */
const native = NativeModules.CarPlayStatus as { isActive(): Promise<boolean> } | undefined;

export async function isCarPlayActive(): Promise<boolean> {
  if (!native) {
    return false;
  }

  try {
    return await native.isActive();
  } catch {
    return false;
  }
}
