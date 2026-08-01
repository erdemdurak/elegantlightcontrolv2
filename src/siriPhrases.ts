/**
 * The spoken vocabulary, for the in-app reference card.
 *
 * Display-only. The authority is `LightColorOption` in
 * ios/ElegantLightControl/AmbientIntents.swift — what Siri actually accepts is compiled from
 * there — so this list has to be updated alongside it. Presets and modes are read from their
 * real sources instead and cannot drift.
 */

/** Must match CFBundleDisplayName; App Shortcut phrases interpolate it as `applicationName`. */
export const APP_SPOKEN_NAME = "Elegant Light";

export const SIRI_COLOR_NAMES = [
  "red",
  "orange",
  "deep orange",
  "light orange",
  "salmon",
  "warm white",
  "yellow",
  "warm yellow",
  "lime",
  "yellow green",
  "green",
  "teal",
  "turquoise",
  "baby blue",
  "light blue",
  "blue",
  "violet",
  "purple",
  "pink",
  "magenta",
  "white",
];

/** Spoken names for the modes, which differ from the button labels. */
export const SIRI_MODE_NAMES: Record<string, string> = {
  monochrome: "solid colour",
  breathe: "breathe",
  auto: "auto",
  gradient: "gradient",
  strobe: "strobe",
};
