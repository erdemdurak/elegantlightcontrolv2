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
  /**
   * HSV value of the chosen colour, 0-100. Part of the colour itself: picking a dark shade
   * from the wheel or grid must stay dark. `brightness` is the separate dimmer applied on
   * top. Older saved states predate this field, so it defaults to 100.
   */
  value?: number;
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
  /**
   * Last controller connected to, so the app can reconnect on its own. Siri launches the app
   * to perform a write, and a command that arrives to a disconnected app does nothing.
   */
  lastDeviceId?: string | null;
};
