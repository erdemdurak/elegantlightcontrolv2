export type AmbientMode = "monochrome" | "gradient" | "strobe" | "breathe";

export type GradientSpeed = 1 | 2 | 3 | 4 | 5;

/** Which strip the controls are currently driving. */
export type AreaKey = "area1" | "area2";

export type ControlTarget = AreaKey | "both";

/**
 * The target + protocol combination confirmed to control the strip, saved once the
 * Protocol Sweep identifies it so normal sends stop guessing.
 *
 * `zoneVariantId` is filled in separately by the Zone Sweep. While it is null the
 * app can only broadcast to both areas at once.
 */
export type LockedProfile = {
  serviceUuid: string;
  characteristicUuid: string;
  familyId: string;
  familyLabel: string;
  zoneVariantId?: string | null;
  zoneVariantLabel?: string | null;
};

export type LightSettings = {
  hue: number;
  saturation: number;
  brightness: number;
  mode: AmbientMode;
  speed: GradientSpeed;
  /** Colours cycled by the app-driven gradient effect. 2-6 entries. */
  gradientColors: string[];
};

export type AppStateSnapshot = {
  area1: LightSettings;
  area2: LightSettings;
  savedPalette: string[];
  lockedProfile?: LockedProfile | null;
};
