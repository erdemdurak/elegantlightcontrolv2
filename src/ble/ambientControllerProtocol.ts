import { decode } from "base-64";

import type { AmbientMode } from "../types";
import { rgbToHex } from "../utils/color";

export type ParsedControllerState = {
  mode?: AmbientMode;
  hue?: number;
  saturation?: number;
  brightness?: number;
  speed?: number;
  colorHex?: string;
  gradientColors?: string[];
};

function base64ToBytes(value: string): number[] {
  const binary = decode(value);
  const bytes: number[] = [];

  for (let index = 0; index < binary.length; index += 1) {
    bytes.push(binary.charCodeAt(index) & 0xff);
  }

  return bytes;
}

function bytesToText(bytes: number[]): string {
  return String.fromCharCode(...bytes.map((value) => value & 0xff)).trim();
}

function hexFromRgbTriplet(r: number, g: number, b: number): string {
  return rgbToHex({ r, g, b });
}

function parseMode(value: unknown): AmbientMode | undefined {
  if (value === "monochrome" || value === "gradient" || value === "strobe" || value === "breathe") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return "monochrome";
    if (value === 2) return "gradient";
    if (value === 3) return "strobe";
    if (value === 4) return "breathe";
    return undefined;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "mono" || normalized === "monochrome") return "monochrome";
    if (normalized === "2" || normalized === "gradient" || normalized === "rgb") return "gradient";
    if (normalized === "3" || normalized === "strobe") return "strobe";
    if (normalized === "4" || normalized === "breathe" || normalized === "breath") return "breathe";
  }

  return undefined;
}

function normalizeGradientColors(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const colors = value
    .map((entry) => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
          return trimmed.startsWith("#") ? trimmed.toUpperCase() : `#${trimmed.toUpperCase()}`;
        }

        // "255-0-0" style entries emitted by the ASCII line format.
        const triplet = trimmed.split("-").map((part) => Number(part));
        if (triplet.length === 3 && triplet.every((part) => Number.isFinite(part))) {
          return hexFromRgbTriplet(triplet[0], triplet[1], triplet[2]);
        }

        return null;
      }

      if (entry && typeof entry === "object") {
        const color = entry as { r?: unknown; g?: unknown; b?: unknown };
        if (typeof color.r === "number" && typeof color.g === "number" && typeof color.b === "number") {
          return rgbToHex({ r: color.r, g: color.g, b: color.b });
        }
      }

      return null;
    })
    .filter((entry): entry is string => Boolean(entry));

  return colors.length > 0 ? colors : undefined;
}

function parseJsonState(trimmed: string): ParsedControllerState | null {
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const rgb = parsed.rgb as { r?: unknown; g?: unknown; b?: unknown } | undefined;
    const hex = typeof parsed.colorHex === "string" ? parsed.colorHex : undefined;
    const gradientColors = normalizeGradientColors(parsed.gradient);
    const hasRgb =
      rgb && typeof rgb.r === "number" && typeof rgb.g === "number" && typeof rgb.b === "number";

    if (!hasRgb && !hex && !gradientColors) {
      return null;
    }

    return {
      mode: parseMode(parsed.mode),
      hue: typeof parsed.hue === "number" ? parsed.hue : undefined,
      saturation: typeof parsed.saturation === "number" ? parsed.saturation : undefined,
      brightness: typeof parsed.brightness === "number" ? parsed.brightness : undefined,
      speed: typeof parsed.speed === "number" ? parsed.speed : undefined,
      colorHex: hex ?? (hasRgb ? rgbToHex({ r: rgb.r as number, g: rgb.g as number, b: rgb.b as number }) : undefined),
      gradientColors,
    };
  } catch {
    return null;
  }
}

/**
 * Parses the "$AMBIENT,zone,mode,r,g,b,brightness,speed,gradient" line format.
 * Field order after the header is: [0]=zone [1]=mode [2]=r [3]=g [4]=b [5]=brightness [6]=speed [7]=gradient
 */
function parseAmbientLine(text: string): ParsedControllerState | null {
  const parts = text.replace(/^\$AMBIENT,?/, "").split(",");
  if (parts.length < 5) {
    return null;
  }

  const r = Number(parts[2]);
  const g = Number(parts[3]);
  const b = Number(parts[4]);
  const hasColor = [r, g, b].every((value) => Number.isFinite(value));

  const brightness = Number(parts[5]);
  const speed = Number(parts[6]);

  return {
    mode: parseMode(parts[1]),
    brightness: Number.isFinite(brightness) ? brightness : undefined,
    speed: Number.isFinite(speed) ? speed : undefined,
    colorHex: hasColor ? hexFromRgbTriplet(r, g, b) : undefined,
    gradientColors: parts[7]
      ? normalizeGradientColors(parts[7].split(";").map((entry) => entry.trim()).filter(Boolean))
      : undefined,
  };
}

export function decodeControllerStatePayload(payload: string): ParsedControllerState | null {
  const trimmed = payload.trim();
  if (!trimmed) {
    return null;
  }

  const jsonResult = parseJsonState(trimmed);
  if (jsonResult) {
    return jsonResult;
  }

  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0) {
    try {
      const bytes = base64ToBytes(trimmed);
      const text = bytesToText(bytes);

      if (text.startsWith("$AMBIENT")) {
        return parseAmbientLine(text);
      }

      if (bytes.length >= 10 && bytes[0] === 0xaa && bytes[1] === 0x55) {
        const gradientCount = bytes[9] ?? 0;
        const gradientColors: string[] = [];

        for (let index = 0; index < gradientCount; index += 1) {
          const baseIndex = 10 + index * 3;
          if (baseIndex + 2 >= bytes.length) {
            break;
          }

          gradientColors.push(hexFromRgbTriplet(bytes[baseIndex], bytes[baseIndex + 1], bytes[baseIndex + 2]));
        }

        return {
          mode: parseMode(bytes[3]),
          brightness: bytes[7],
          speed: bytes[8],
          colorHex: hexFromRgbTriplet(bytes[4], bytes[5], bytes[6]),
          gradientColors: gradientColors.length > 0 ? gradientColors : undefined,
        };
      }

      // BLEDOM-style colour frame echoed back: 7E 00 05 03 R G B 00 EF
      if (bytes.length >= 9 && bytes[0] === 0x7e && bytes[2] === 0x05 && bytes[8] === 0xef) {
        return { colorHex: hexFromRgbTriplet(bytes[4], bytes[5], bytes[6]) };
      }

      // Triones-style colour frame echoed back: 56 R G B 00 F0 AA
      if (bytes.length >= 7 && bytes[0] === 0x56 && bytes[6] === 0xaa) {
        return { colorHex: hexFromRgbTriplet(bytes[1], bytes[2], bytes[3]) };
      }

      if (/^\d{1,3},\d{1,3},\d{1,3}$/.test(text)) {
        const [r, g, b] = text.split(",").map((part) => Number(part));
        return { colorHex: hexFromRgbTriplet(r, g, b) };
      }

      if (text.startsWith("AT+RGB=") || text.startsWith("AT+COLOR=")) {
        const digits = text.match(/\d{1,3}/g)?.map((part) => Number(part)) ?? [];
        if (digits.length >= 3) {
          return {
            colorHex: hexFromRgbTriplet(digits[0], digits[1], digits[2]),
            brightness: digits[3],
          };
        }
      }
    } catch {
      // Not base64, or not decodable as any known frame.
    }
  }

  if (trimmed.startsWith("$AMBIENT")) {
    return parseAmbientLine(trimmed);
  }

  return null;
}
