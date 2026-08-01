import type { LightSettings } from "../types";
import { hexToRgb, hsvToRgb, rgbToHsv } from "../utils/color";
import type { Rgb } from "./protocolFamilies";

/**
 * Effects are driven from the phone rather than by the controller's built-in modes.
 *
 * Cheap BLE controllers only store a fixed rainbow for their "gradient" effect — there
 * is no way to upload a custom colour list. Computing each frame here and sending it as
 * a plain static-colour command gives genuine user-selected colour cycling, and works on
 * any controller that can set a colour at all.
 */

/**
 * Full cycle duration in milliseconds, by speed setting.
 *
 * These are roughly 3x the original values. In the car the old "normal" read as frantic,
 * and a short period also means very few frames per colour transition (the BLE write rate
 * is capped around 5-9 fps), which is what made the changes look like jumps rather than
 * a fade.
 */
const PERIOD_BY_SPEED: Record<number, number> = {
  1: 45000,
  2: 28000,
  3: 17000,
  4: 9000,
  5: 4000,
};

/** Breathe and strobe need their own scales — a 17s strobe is not a strobe. */
const BREATHE_PERIOD_BY_SPEED: Record<number, number> = {
  1: 12000,
  2: 8000,
  3: 5000,
  4: 3000,
  5: 1600,
};

const STROBE_PERIOD_BY_SPEED: Record<number, number> = {
  1: 1200,
  2: 800,
  3: 500,
  4: 300,
  5: 160,
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

/** Ease in and out of each colour stop so transitions arrive gently instead of snapping. */
function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Blend two colours through HSV, taking the shorter way round the hue circle.
 *
 * Straight RGB interpolation drags every transition through a muddy midpoint — red to blue
 * passes through dark grey-purple rather than magenta — which reads as an abrupt, synthetic
 * change. Rotating the hue keeps saturation up the whole way, so it looks like the light is
 * sweeping through the spectrum.
 */
function mixThroughHue(from: Rgb, to: Rgb, t: number): Rgb {
  const a = rgbToHsv(from);
  const b = rgbToHsv(to);

  // A colour with no saturation has no meaningful hue; borrow the other end's so we do not
  // rotate towards an arbitrary one.
  const hueA = a.s < 1 ? b.h : a.h;
  const hueB = b.s < 1 ? a.h : b.h;

  let delta = ((hueB - hueA + 540) % 360) - 180;
  const hue = (hueA + delta * t + 360) % 360;

  return hsvToRgb(hue, a.s + (b.s - a.s) * t, a.v + (b.v - a.v) * t);
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
  const base = hsvToRgb(settings.hue, settings.saturation, settings.value ?? 100);
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
    return scale(mixThroughHue(from, to, smoothstep(localT)), brightnessFactor);
  }

  if (settings.mode === "breathe") {
    const breathePeriod = BREATHE_PERIOD_BY_SPEED[settings.speed] ?? 5000;
    const phase = (elapsedMs % breathePeriod) / breathePeriod;
    const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
    // Never fully dark, so the strip does not look like it switched off.
    return scale(base, brightnessFactor * (0.08 + 0.92 * wave));
  }

  if (settings.mode === "strobe") {
    const strobePeriod = STROBE_PERIOD_BY_SPEED[settings.speed] ?? 500;
    const on = elapsedMs % strobePeriod < strobePeriod / 2;
    return on ? scale(base, brightnessFactor) : { r: 0, g: 0, b: 0 };
  }

  return scale(base, brightnessFactor);
}

/** How often to push a frame, given how many areas are being animated. */
export function frameIntervalMs(areaCount: number): number {
  return areaCount > 1 ? 190 : 110;
}
