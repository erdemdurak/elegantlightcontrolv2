import { encode } from "base-64";

import type { BleCommand, ProtocolProfile, ZoneKey, ZoneSettings } from "../types";
import { hexToRgb, hsvToHex } from "../utils/color";

function buildBleCommand(zone: ZoneKey, settings: ZoneSettings): BleCommand {
  const zoneColor = hsvToHex(settings.hue, settings.saturation, settings.brightness);

  return {
    zone,
    mode: settings.mode,
    rgb: hexToRgb(zoneColor),
    brightness: Math.round(settings.brightness),
    speed: settings.speed,
    gradient: settings.gradientColors.map((hex) => hexToRgb(hex)),
  };
}

function modeToCode(mode: ZoneSettings["mode"]): number {
  if (mode === "monochrome") {
    return 1;
  }

  if (mode === "gradient") {
    return 2;
  }

  if (mode === "strobe") {
    return 3;
  }

  return 4;
}

function zoneToNumber(zone: ZoneKey): number {
  return zone === "zoneA" ? 1 : 2;
}

function bytesToBase64(bytes: number[]): string {
  const binary = String.fromCharCode(...bytes.map((value) => value & 0xff));
  return encode(binary);
}

function encodeAsJson(payload: BleCommand): string {
  return encode(JSON.stringify(payload));
}

function encodeAsAsciiLine(payload: BleCommand): string {
  const gradient = payload.gradient.map((color) => `${color.r}-${color.g}-${color.b}`).join(";");

  const line = [
    "$AMBIENT",
    payload.zone === "zoneA" ? "1" : "2",
    String(modeToCode(payload.mode)),
    String(payload.rgb.r),
    String(payload.rgb.g),
    String(payload.rgb.b),
    String(payload.brightness),
    String(payload.speed),
    gradient,
  ].join(",");

  return encode(`${line}\n`);
}

function encodeAsFrame(payload: BleCommand): string {
  const gradientCount = Math.min(payload.gradient.length, 5);
  const gradientBytes: number[] = [];

  for (let index = 0; index < 5; index += 1) {
    const color = payload.gradient[index] ?? { r: 0, g: 0, b: 0 };
    gradientBytes.push(color.r, color.g, color.b);
  }

  const frameWithoutChecksum = [
    0xaa,
    0x55,
    zoneToNumber(payload.zone),
    modeToCode(payload.mode),
    payload.rgb.r,
    payload.rgb.g,
    payload.rgb.b,
    payload.brightness,
    payload.speed,
    gradientCount,
    ...gradientBytes,
  ];

  const checksum = frameWithoutChecksum.reduce((sum, byte) => (sum + byte) & 0xff, 0);
  const completeFrame = [...frameWithoutChecksum, checksum];
  return bytesToBase64(completeFrame);
}

export function encodeZoneSettings(
  zone: ZoneKey,
  settings: ZoneSettings,
  profile: ProtocolProfile,
): string {
  const payload = buildBleCommand(zone, settings);

  if (profile === "at-rgb-v1") {
    return encodeAsAsciiLine(payload);
  }

  if (profile === "frame-v1") {
    return encodeAsFrame(payload);
  }

  return encodeAsJson(payload);
}
