import type { LightSettings } from "./types";
import { hexToHsv } from "./utils/color";

/**
 * Built-in colour pairs for a W205 with the black leather interior.
 *
 * What the cabin does to a colour, and why these nine:
 *
 * - Black leather and Artico absorb light. Anything pale and unsaturated dies on the seats
 *   and reads only as a thin line on the door trim, so pure white is here once, deliberately
 *   dimmed, and never as a pair with another pastel.
 * - The W205 dash lights its own switchgear, cluster needles and climate row in **amber**.
 *   Fighting that is what makes cheap ambient kits look aftermarket. Warm themes join it;
 *   cool themes contrast it cleanly. Yellow-green sits between the two and clashes with
 *   both, so the one green here is pushed to the blue side of the wheel and none of the
 *   hues between roughly 80 and 110 degrees are used at all.
 * - Area 2 is vents and tweeter grilles — small, ringed in chrome, and the chrome throws the
 *   colour back at you. It carries the saturated half of every pair.
 * - Area 1 is the long door lines and the console. Run at the same intensity as the vents it
 *   dominates the mirror and the side glass, so it sits a step lower in almost every theme.
 *
 * Brightness is the dimmer, not the colour — see LightSettings.
 */

export type Theme = {
  id: string;
  name: string;
  /** Door trim lines and centre console. */
  area1: { hex: string; brightness: number };
  /** Air vents and Burmester tweeter grilles. */
  area2: { hex: string; brightness: number };
  hint: string;
};

export const BUILT_IN_THEMES: Theme[] = [
  {
    id: "burmester",
    name: "Burmester",
    area1: { hex: "#FFD8A8", brightness: 65 },
    area2: { hex: "#FF8000", brightness: 85 },
    hint: "Warm white doors, amber vents — matches the factory dash lighting",
  },
  {
    id: "amg",
    name: "AMG",
    area1: { hex: "#FFC400", brightness: 70 },
    area2: { hex: "#00BBFF", brightness: 85 },
    hint: "Amber doors, cyan vents — the AMG cluster's own yellow and blue",
  },
  {
    id: "night-drive",
    name: "Night Drive",
    area1: { hex: "#000FFF", brightness: 60 },
    area2: { hex: "#1500FF", brightness: 80 },
    hint: "The signature Mercedes blue, deepest on the doors",
  },
  {
    id: "ice",
    name: "Ice",
    area1: { hex: "#DCEBFF", brightness: 60 },
    area2: { hex: "#00D2FF", brightness: 85 },
    hint: "Cool white doors, cyan vents — the coldest pair here",
  },
  {
    id: "sunset",
    name: "Sunset",
    area1: { hex: "#FF0066", brightness: 65 },
    area2: { hex: "#FF7A00", brightness: 80 },
    hint: "Rose doors into amber vents",
  },
  {
    id: "lounge",
    name: "Lounge",
    area1: { hex: "#6600FF", brightness: 60 },
    area2: { hex: "#00A6FF", brightness: 80 },
    hint: "Violet doors, azure vents — strongest contrast of the eight",
  },
  {
    id: "copper",
    name: "Copper",
    area1: { hex: "#FF5500", brightness: 60 },
    area2: { hex: "#FFBF00", brightness: 80 },
    hint: "Ember doors, gold vents — warmest, best with the chrome trim",
  },
  {
    id: "emerald",
    name: "Emerald",
    area1: { hex: "#00FF56", brightness: 90 },
    area2: { hex: "#00E6A0", brightness: 75 },
    hint: "Bright green doors, mint vents — the doors carry this one, unusually",
  },
  {
    id: "nightshade",
    name: "Nightshade",
    area1: { hex: "#8000FF", brightness: 60 },
    area2: { hex: "#0000FF", brightness: 75 },
    hint: "Violet doors, deep blue vents — pure blue reads darkest of any hue on the strip",
  },
  {
    id: "amethyst",
    name: "Amethyst",
    area1: { hex: "#9900FF", brightness: 60 },
    area2: { hex: "#00CCFF", brightness: 80 },
    hint: "Violet doors, light blue vents — a colder, wider-apart take on Lounge",
  },
  {
    id: "ultraviolet",
    name: "Ultraviolet",
    area1: { hex: "#4000FF", brightness: 55 },
    area2: { hex: "#BF00FF", brightness: 80 },
    hint: "Indigo doors, magenta vents — the two ends of violet against each other",
  },
  {
    id: "alpine",
    name: "Alpine",
    area1: { hex: "#FFFFFF", brightness: 50 },
    area2: { hex: "#FFFFFF", brightness: 70 },
    hint: "Plain white, held low so the leather keeps its grain",
  },
];

export const DEFAULT_DAY_THEME_ID = "burmester";
export const DEFAULT_NIGHT_THEME_ID = "night-drive";

/** Night starts at this hour, and day at DAY_START_HOUR. Local clock, 24h. */
const NIGHT_START_HOUR = 19;
const DAY_START_HOUR = 7;

/**
 * Whether the cabin should be on its night preset.
 *
 * Deliberately the clock rather than actual sunrise/sunset: real sun times need the user's
 * location, and this app asks for no location permission at all. A fixed boundary is wrong by
 * an hour or so at the solstices, which for choosing between amber and blue is close enough.
 */
export function isNightAt(date: Date): boolean {
  const hour = date.getHours();
  return hour >= NIGHT_START_HOUR || hour < DAY_START_HOUR;
}

/** Both halves of a theme as a stored day/night profile. Used for defaults and migration. */
export function themeToProfile(id: string): { area1: LightSettings; area2: LightSettings } | null {
  const theme = BUILT_IN_THEMES.find((entry) => entry.id === id);
  if (!theme) {
    return null;
  }

  return { area1: themeToSettings(theme, "area1"), area2: themeToSettings(theme, "area2") };
}

/**
 * Expands one half of a theme into full settings. The pair's two colours are also seeded as
 * the gradient stops, so switching that area to gradient mode animates between them instead
 * of falling back to whatever was there before.
 */
export function themeToSettings(theme: Theme, area: "area1" | "area2"): LightSettings {
  const { hex, brightness } = theme[area];
  const hsv = hexToHsv(hex);

  return {
    hue: hsv.h,
    saturation: hsv.s,
    value: hsv.v,
    brightness,
    mode: "monochrome",
    speed: 3,
    gradientColors: [theme.area1.hex, theme.area2.hex],
  };
}
