export type AmbientMode = "monochrome" | "gradient" | "strobe" | "breathe";

export type ZoneKey = "zoneA" | "zoneB";

export type GradientSpeed = 1 | 2 | 3 | 4 | 5;

export type ProtocolProfile = "json-v1" | "at-rgb-v1" | "frame-v1";

export type SceneGroup = "Day" | "Night" | "Cruise" | "Party" | "Calm" | "Custom";

export type ZoneSettings = {
  hue: number;
  saturation: number;
  brightness: number;
  mode: AmbientMode;
  gradientColors: string[];
  speed: GradientSpeed;
};

export type AppStateSnapshot = {
  zoneA: ZoneSettings;
  zoneB: ZoneSettings;
  savedPalette: string[];
  scenes?: ScenePreset[];
  protocolProfile?: ProtocolProfile;
  autoSendEnabled?: boolean;
  autoSendIntervalMs?: number;
};

export type ScenePreset = {
  id: string;
  name: string;
  group: SceneGroup;
  zoneA: ZoneSettings;
  zoneB: ZoneSettings;
  createdAt: number;
};

export type BleCommand = {
  zone: ZoneKey;
  mode: AmbientMode;
  rgb: {
    r: number;
    g: number;
    b: number;
  };
  brightness: number;
  speed: GradientSpeed;
  gradient: Array<{
    r: number;
    g: number;
    b: number;
  }>;
};
