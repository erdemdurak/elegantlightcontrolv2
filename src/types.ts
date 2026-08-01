/**
 * `breathe` and `auto` are run by the controller itself and survive the app closing.
 * `gradient` and `strobe` are computed on the phone, so they need it in the foreground
 * (or the audio keepalive) but can use colours you pick.
 */
export type AmbientMode = "monochrome" | "gradient" | "strobe" | "breathe" | "auto";

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
  /** Apply a profile automatically on connect, chosen by the clock. */
  autoDayNight?: boolean;
  dayProfile?: DayNightProfile;
  nightProfile?: DayNightProfile;
  /** Superseded by dayProfile/nightProfile; still read once so older saves migrate. */
  dayThemeId?: string;
  nightThemeId?: string;
};

/**
 * A full cabin state — both areas, each with its own colour, brightness and mode. Stored
 * rather than a preset id so day and night can be tuned freely instead of being limited to
 * the twelve built-ins.
 */
export type DayNightProfile = {
  area1: LightSettings;
  area2: LightSettings;
};
