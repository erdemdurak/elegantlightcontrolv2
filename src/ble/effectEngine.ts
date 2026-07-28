import type { LightSettings } from "../types";
import { hexToRgb, hsvToRgb } from "../utils/color";
import type { Rgb } from "./protocolFamilies";

/**
 * Effects are driven from the phone rather than by the controller's built-in modes.
 *
 * Cheap BLE controllers only store a fixed rainbow for their "gradient" effect — there
 * is no way to upload a custom colour list. Computing each frame here and sending it as
 * a plain static-colour command gives genuine user-selected colour cycling, and works on
 * any controller that can set a colour at all.
 */

/** Full cycle duration in milliseconds, by speed setting. */
const PERIOD_BY_SPEED: Record<number, number> = {
  1: 14000,
  2: 9000,
  3: 5500,
  4: 3000,
  5: 1500,
};

function scale(rgb: Rgb, factor: number): Rgb {
  const clamped = Math.max(0, Math.min(1, factor));
  return {
    r: Math.round(rgb.r * clamped),
    g: Math.round(rgb.g * clamped),
    b: Math.round(rgb.b * clamped),
  };
}

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
}

export function isAnimatedMode(settings: LightSettings): boolean {
  if (settings.mode === "monochrome") {
    return false;
  }

  if (settings.mode === "gradient") {
    return settings.gradientColors.length >= 2;
  }

  return true;
}

/**
 * The colour to send right now, with brightness already folded in so a single
 * colour command per frame is enough.
 */
export function computeEffectRgb(settings: LightSettings, elapsedMs: number): Rgb {
  const base = hsvToRgb(settings.hue, settings.saturation, 100);
  const brightnessFactor = settings.brightness / 100;
  const period = PERIOD_BY_SPEED[settings.speed] ?? 5500;

  if (settings.mode === "gradient" && settings.gradientColors.length >= 2) {
    const colors = settings.gradientColors.map((hex) => hexToRgb(hex));
    const segment = period / colors.length;
    const position = elapsedMs % period;
    const index = Math.floor(position / segment);
    const localT = (position - index * segment) / segment;

    const from = colors[index % colors.length];
    const to = colors[(index + 1) % colors.length];
    return scale(mix(from, to, localT), brightnessFactor);
  }

  if (settings.mode === "breathe") {
    const phase = (elapsedMs % period) / period;
    const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
    // Never fully dark, so the strip does not look like it switched off.
    return scale(base, brightnessFactor * (0.08 + 0.92 * wave));
  }

  if (settings.mode === "strobe") {
    const strobePeriod = Math.max(140, period / 12);
    const on = elapsedMs % strobePeriod < strobePeriod / 2;
    return on ? scale(base, brightnessFactor) : { r: 0, g: 0, b: 0 };
  }

  return scale(base, brightnessFactor);
}

/** How often to push a frame, given how many areas are being animated. */
export function frameIntervalMs(areaCount: number): number {
  return areaCount > 1 ? 190 : 110;
}
