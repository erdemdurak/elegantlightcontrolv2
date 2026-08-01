import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import ColorPickerRaw from "react-native-wheel-color-picker";

/**
 * The wheel sizes itself from its own root style (`[ss.root, ..., style]`, root is flex:1),
 * so the size has to go on the component, not a wrapper. `style` is missing from the
 * package's type definitions even though it is applied, hence the cast.
 */
const ColorPicker = ColorPickerRaw as unknown as React.ComponentType<
  Record<string, unknown> & { style?: { width: number; height: number } }
>;
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  ActivityIndicator,
  Dimensions,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Device } from "react-native-ble-plx";

import {
  BleAmbientController,
  type GattEntry,
  type SweepStep,
  type ZoneSweepStep,
} from "./src/ble/bleAmbientController";
import type {
  AmbientMode,
  AppStateSnapshot,
  ControlTarget,
  LightSettings,
  LockedProfile,
} from "./src/types";
import { computeEffectRgb, frameIntervalMs, isAnimatedMode } from "./src/ble/effectEngine";
import { startKeepAlive, stopKeepAlive } from "./src/ble/backgroundKeepAlive";
import { consumeSiriCommand, type SiriCommand } from "./src/ble/siriCommands";
import { hexToHsv, hsvToHex, vibrantSaturation } from "./src/utils/color";
import { InteriorPreview } from "./src/components/InteriorPreview";
import { BUILT_IN_THEMES, themeToSettings, type Theme } from "./src/themes";

const STORAGE_KEY = "ambient-light-controller-state";

/** Bump on every build so "which version am I running" is answerable at a glance. */
const BUILD_LABEL = "v2 · lenze-v32 · renamed Elegant Light";

/**
 * Protocol Sweep, Command Lab and Diagnostics are identification tools — they were needed to
 * find the protocol, not to use the lights. Flip this to show them again.
 */
const SHOW_DEV_TOOLS: boolean = false;

/**
 * Every hue here has one channel at 255 and one at 0, so HSV saturation is exactly 100%.
 *
 * The previous set did not: #FFC31A was 89.8% saturated, #1EA5E9 only 87.1% at 91% value.
 * That third channel lights the third LED and physically dilutes the colour on the strip,
 * which is why the swatches came out visibly paler than the same hue picked off the wheel —
 * wheel picks snap to full saturation in the outer band. Yellow suffered worst of all.
 *
 * Keep new entries to `00` / `FF` / one free channel. The last two are the deliberate
 * exceptions: white, and the warm white the W205 uses as its own ambient tone.
 */
const presetColors = [
  "#FF0000", // red
  "#FF4000", // vermilion
  "#FF8000", // orange
  "#FFBF00", // amber
  "#FFFF00", // yellow
  "#80FF00", // lime
  "#00FF00", // green
  "#00FF80", // spring
  "#00FFFF", // cyan
  "#0080FF", // azure
  "#0000FF", // blue
  "#4000FF", // indigo
  "#8000FF", // violet
  "#BF00FF", // purple
  "#FF00FF", // magenta
  "#FF0080", // pink
  "#FFFFFF", // white
  "#FFB870", // warm white — soft on purpose, the factory cabin tone
];

const modeOptions: AmbientMode[] = ["monochrome", "gradient", "strobe", "breathe"];

const speedLabels: Record<number, string> = {
  1: "Extra Slow",
  2: "Slow",
  3: "Normal",
  4: "Fast",
  5: "Very Fast",
};

const targetOptions: Array<{ key: ControlTarget; label: string }> = [
  { key: "area1", label: "Area 1" },
  { key: "area2", label: "Area 2" },
  { key: "both", label: "Both" },
];

const defaultArea1: LightSettings = {
  hue: 200,
  saturation: 85,
  brightness: 80,
  mode: "monochrome",
  speed: 3,
  gradientColors: ["#3B82F6", "#E84393"],
};

const defaultArea2: LightSettings = {
  ...defaultArea1,
  hue: 10,
  gradientColors: ["#FF6A00", "#FFCC00", "#00C8FF"],
};

const MAX_GRADIENT_COLORS = 6;

/** Colour wheel is square and must be a concrete size — see styles.wheelBox. */
/**
 * Deliberately narrower than the card. Touching the wheel has to disable scrolling, or a
 * vertical drag would pick a colour and scroll the page at once — so at full width the wheel
 * became a dead zone the page could not be scrolled through. The gutters either side belong
 * to the ScrollView and always scroll. Losing some radius costs little now that the outer
 * band of the wheel snaps to full saturation.
 */
const WHEEL_SIZE = Math.min(300, Math.round(Dimensions.get("window").width - 120));

/**
 * Candidate commands recovered by decompiling the vendor Android app
 * (com.mingmao.zyblack). Sent verbatim as ASCII.
 */
const vendorCommands: Array<{ label: string; text?: string; hex?: string }> = [
  // CAPTURED from the vendor iOS app on 2026-07-31 via PacketLogger HCI trace.
  // These are literal bytes observed controlling this exact hardware. Send to FFB1.
  // Format: 55 | LEN | CMD | payload | ~(sum) | AA   — both areas in one frame.
  { label: "★ RED both", hex: "550704ff0102ff0102f0aa" },
  { label: "★ GREEN both", hex: "55070403fe1203fe12ceaa" },
  { label: "★ BLUE both", hex: "5507040101fd0101fdf6aa" },
  { label: "★ A1 red / A2 blue", hex: "550704ff01020101fdf3aa" },
  { label: "★ A1 blue / A2 red", hex: "5507040101fdff0102f3aa" },
  { label: "★ WHITE both", hex: "550704fffffffffffffaaa" },
  { label: "★ query state", hex: "550100feaa" },
  { label: "★ switch 00", hex: "55020500f8aa" },
  { label: "★ switch 01", hex: "55020501f7aa" },
  // Superseded guesses, kept only so old notes still resolve.
  { label: "A5 RED (dead)", hex: "a5ff010005ff00000064000005ff01ff01010000" },
  // Bracket ASCII — from the other vendor app, kept for completeness.
  { label: "Handshake", text: "[0A01]" },
  { label: "RED ch1", text: "[06ff0000]" },
  { label: "RED ch2", text: "[10ff0000]" },
  { label: "RED ch3", text: "[09ff0000]" },
];

/**
 * Whether the phone has to compute this mode's frames.
 *
 * `breathe` is handled by the controller now — it modulates the brightness of the static
 * colour we sent, so it keeps running with the app closed. Driving it from here as well would
 * fight the chip and burn BLE bandwidth for nothing.
 */
function isPhoneDrivenMode(settings: LightSettings): boolean {
  return settings.mode !== "breathe" && isAnimatedMode(settings);
}

const defaultPalette = ["#3B82F6", "#E84393", "#FF6A00", "#00B894"];

/** The read-only half of the swatch grid. Saved colours are checked against it. */
const builtInColors = new Set(presetColors.map((color) => color.toUpperCase()));

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeLight(light: LightSettings): LightSettings {
  return {
    hue: clamp(light.hue, 0, 360),
    saturation: clamp(light.saturation, 0, 100),
    value: clamp(light.value ?? 100, 0, 100),
    brightness: clamp(light.brightness, 0, 100),
    mode: modeOptions.includes(light.mode) ? light.mode : "monochrome",
    speed: clamp(Math.round(light.speed), 1, 5) as LightSettings["speed"],
    gradientColors: Array.from(
      new Set((light.gradientColors ?? []).map((hex) => hex.trim().toUpperCase())),
    ).slice(0, MAX_GRADIENT_COLORS),
  };
}

function normalizeHex(hex: string): string {
  return hex.trim().toUpperCase();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unknown BLE error";
}

/**
 * Accepts hex ("7E 00 05 03 FF 00 00 00 EF") or, when the text contains brackets,
 * the vendor's ASCII command form ("[06ff0000]") sent verbatim as characters.
 */
function parseHexBytes(input: string): number[] | null {
  const trimmed = input.trim();
  if (trimmed.includes("[") || trimmed.includes("]")) {
    const bytes: number[] = [];
    for (let index = 0; index < trimmed.length; index += 1) {
      bytes.push(trimmed.charCodeAt(index) & 0xff);
    }
    return bytes.length > 0 ? bytes : null;
  }

  const cleaned = input.replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) {
    return null;
  }

  const bytes: number[] = [];
  for (let index = 0; index < cleaned.length; index += 2) {
    bytes.push(parseInt(cleaned.slice(index, index + 2), 16));
  }
  return bytes;
}

function shortUuid(uuid: string): string {
  const normalized = uuid.toLowerCase().replace(/-/g, "");
  if (normalized.length === 32 && normalized.startsWith("0000")) {
    return uuid.slice(4, 8).toUpperCase();
  }
  return uuid.toUpperCase();
}

function describeGattEntry(entry: GattEntry): string {
  const flags = [
    entry.readable ? "R" : null,
    entry.writableWithResponse ? "W" : null,
    entry.writableWithoutResponse ? "Wnr" : null,
    entry.notifiable ? "N" : null,
  ]
    .filter(Boolean)
    .join("/");

  return `${shortUuid(entry.serviceUuid)} → ${shortUuid(entry.characteristicUuid)}  [${flags || "none"}]`;
}

export default function App() {
  const bleRef = useRef<BleAmbientController | null>(null);
  const getBle = useCallback((): BleAmbientController => {
    if (!bleRef.current) {
      bleRef.current = new BleAmbientController();
    }
    return bleRef.current;
  }, []);

  const [area1, setArea1] = useState<LightSettings>(defaultArea1);
  const [area2, setArea2] = useState<LightSettings>(defaultArea2);
  const [activeTarget, setActiveTarget] = useState<ControlTarget>("both");
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [lastDeviceId, setLastDeviceId] = useState<string | null>(null);
  /** A Siri command that arrived before the controller was connected. */
  const pendingSiriRef = useRef<SiriCommand | null>(null);
  const [savedPalette, setSavedPalette] = useState<string[]>(defaultPalette);
  const [lockedProfile, setLockedProfile] = useState<LockedProfile | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [device, setDevice] = useState<Device | null>(null);
  const [scanResults, setScanResults] = useState<Device[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready. Scan for your controller.");

  const [gattEntries, setGattEntries] = useState<GattEntry[]>([]);
  const [notifyLog, setNotifyLog] = useState<string[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [hexInput, setHexInput] = useState("7E 00 05 03 FF 00 00 00 EF");
  const [hexTargetIndex, setHexTargetIndex] = useState(0);
  const [labCommandIndex, setLabCommandIndex] = useState(-1);
  /** True while a finger is on the colour wheel, so the ScrollView stops stealing the drag. */
  const [pickerActive, setPickerActive] = useState(false);
  /** Colour the wheel started the current drag from — see the picker's `color` prop. */
  const wheelSeedRef = useRef("#000000");
  /** True only between touch-down and touch-up on the wheel — see handleDragColor. */
  const draggingRef = useRef(false);
  const [labRunning, setLabRunning] = useState(false);
  const [workingCommands, setWorkingCommands] = useState<string[]>([]);
  const labCancelRef = useRef(false);

  const [sweepPlan, setSweepPlan] = useState<SweepStep[]>([]);
  const [sweepIndex, setSweepIndex] = useState(-1);
  const [zonePlan, setZonePlan] = useState<ZoneSweepStep[]>([]);
  const [zoneIndex, setZoneIndex] = useState(-1);
  const [sweepLog, setSweepLog] = useState<string[]>([]);

  const appendNotifyLog = useCallback((line: string) => {
    setNotifyLog((prev) => [line, ...prev].slice(0, 40));
  }, []);

  const appendSweepLog = useCallback((line: string) => {
    setSweepLog((prev) => [line, ...prev].slice(0, 30));
  }, []);

  // Load persisted state once.
  useEffect(() => {
    const load = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<AppStateSnapshot> & {
            zoneA?: LightSettings;
            zoneB?: LightSettings;
            light?: LightSettings;
          };

          // Older builds used zoneA/zoneB, then a single `light`.
          const stored1 = parsed.area1 ?? parsed.light ?? parsed.zoneA;
          const stored2 = parsed.area2 ?? parsed.zoneB;
          if (stored1) {
            setArea1(normalizeLight(stored1));
          }
          if (stored2) {
            setArea2(normalizeLight(stored2));
          }

          if (Array.isArray(parsed.savedPalette) && parsed.savedPalette.length > 0) {
            setSavedPalette(Array.from(new Set(parsed.savedPalette)).slice(0, 20));
          }

          if (parsed.lockedProfile) {
            setLockedProfile(parsed.lockedProfile);
            getBle().setLockedProfile(parsed.lockedProfile);
          }

          if (parsed.lastDeviceId) {
            setLastDeviceId(parsed.lastDeviceId);
          }
        }
      } catch {
        setStatusMessage("Could not load saved state. Using defaults.");
      } finally {
        setHydrated(true);
      }
    };

    void load();
  }, [getBle]);

  // Persist, debounced so dragging the colour wheel does not hammer storage.
  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const handle = setTimeout(() => {
      const payload: AppStateSnapshot = { area1, area2, savedPalette, lockedProfile, lastDeviceId };
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }, 400);

    return () => clearTimeout(handle);
  }, [area1, area2, savedPalette, lockedProfile, lastDeviceId, hydrated]);

  useEffect(() => {
    return () => {
      bleRef.current?.destroy();
      bleRef.current = null;
    };
  }, []);

  const activeSettings = activeTarget === "area2" ? area2 : area1;

  const currentColor = useMemo(
    () => hsvToHex(activeSettings.hue, activeSettings.saturation, activeSettings.value ?? 100),
    [activeSettings.hue, activeSettings.saturation, activeSettings.value],
  );

  const area1Color = useMemo(
    () => hsvToHex(area1.hue, area1.saturation, area1.value ?? 100),
    [area1.hue, area1.saturation, area1.value],
  );
  const area2Color = useMemo(
    () => hsvToHex(area2.hue, area2.saturation, area2.value ?? 100),
    [area2.hue, area2.saturation, area2.value],
  );

  const canAddressAreas = Boolean(lockedProfile?.zoneVariantId);

  // Both halves share one grid keyed by colour, so a saved copy of a built-in would collide.
  const customPalette = useMemo(
    () => savedPalette.filter((color) => !builtInColors.has(normalizeHex(color))),
    [savedPalette],
  );

  const applyToActive = useCallback(
    (next: LightSettings) => {
      // Every manual edit funnels through here, so this is the one place a theme stops
      // being the thing on screen.
      setActiveThemeId(null);

      if (activeTarget === "both") {
        setArea1(next);
        setArea2(next);
        return;
      }

      if (activeTarget === "area1") {
        setArea1(next);
        return;
      }

      setArea2(next);
    },
    [activeTarget],
  );

  const sendActive = useCallback(
    async (next: LightSettings) => {
      if (!device) {
        return;
      }

      try {
        setIsBusy(true);
        await getBle().sendArea(activeTarget, next);
      } catch (error) {
        setStatusMessage(`Send failed: ${getErrorMessage(error)}`);
      } finally {
        setIsBusy(false);
      }
    },
    [activeTarget, device, getBle],
  );

  const applyAndSend = (next: LightSettings) => {
    const normalized = normalizeLight(next);
    applyToActive(normalized);
    void sendActive(normalized);
  };

  /** Sets both areas at once and pushes them, used by presets and by the area swap. */
  const applyPair = (next1: LightSettings, next2: LightSettings, what: string) => {
    setArea1(next1);
    setArea2(next2);

    if (!device) {
      setStatusMessage(`${what} set — connect to send it.`);
      return;
    }

    void (async () => {
      try {
        setIsBusy(true);
        // A frame carries both halves, so the protocol layer needs the new pair in hand
        // before either send — otherwise the first write ships the old other-half colour.
        getBle().seedAreaColors(next1, next2);

        if (canAddressAreas) {
          await getBle().sendArea("area1", next1);
          await getBle().sendArea("area2", next2);
        } else {
          // Broadcasting twice would just leave Area 2's colour on everything. The doors
          // are the larger surface, so they win the fallback.
          await getBle().sendArea("both", next1);
        }

        setStatusMessage(
          canAddressAreas
            ? `Applied ${what}.`
            : `Applied ${what} — both strips show the Area 1 colour until area addressing is found.`,
        );
      } catch (error) {
        setStatusMessage(`Send failed: ${getErrorMessage(error)}`);
      } finally {
        setIsBusy(false);
      }
    })();
  };

  const handleApplyTheme = (theme: Theme) => {
    setActiveThemeId(theme.id);
    applyPair(
      normalizeLight(themeToSettings(theme, "area1")),
      normalizeLight(themeToSettings(theme, "area2")),
      theme.name,
    );
  };

  /** Mirrors a preset across the cabin — vents get the doors' colour and vice versa. */
  const handleSwapAreas = () => {
    setActiveThemeId(null);
    applyPair(area2, area1, "Swapped areas");
  };

  const handleAddGradientColor = () => {
    const next = normalizeHex(currentColor);
    const existing = activeSettings.gradientColors;

    if (existing.includes(next)) {
      setStatusMessage("That colour is already in the gradient.");
      return;
    }

    if (existing.length >= MAX_GRADIENT_COLORS) {
      setStatusMessage(`A gradient holds up to ${MAX_GRADIENT_COLORS} colours.`);
      return;
    }

    applyToActive(normalizeLight({ ...activeSettings, gradientColors: [...existing, next] }));
    setStatusMessage(`Added ${next} to the gradient.`);
  };

  const handleRemoveGradientColor = (color: string) => {
    applyToActive(
      normalizeLight({
        ...activeSettings,
        gradientColors: activeSettings.gradientColors.filter((entry) => entry !== color),
      }),
    );
  };

  // The animation loop reads settings through a ref so that changing a colour mid-effect
  // does not tear down and restart the loop.
  const settingsRef = useRef({ area1, area2 });
  settingsRef.current = { area1, area2 };

  // Mirror the live colours into the protocol layer on every change, so a single-area send
  // always fills the other half with the truth rather than a stale default.
  useEffect(() => {
    getBle().seedAreaColors(area1, area2);
  }, [area1, area2, getBle]);

  /**
   * Applies a command handed over by an App Intent. Siri cold-launches the app, so this can
   * run before the controller is connected — in that case it is parked and replayed by the
   * reconnect effect below.
   */
  const runSiriCommand = useCallback(
    (command: SiriCommand) => {
      if (!device) {
        pendingSiriRef.current = command;
        setStatusMessage("Siri command queued — connecting...");
        return;
      }

      if (command.type === "preset") {
        const theme = BUILT_IN_THEMES.find((entry) => entry.id === command.value);
        if (theme) {
          handleApplyTheme(theme);
        }
        return;
      }

      if (command.type === "power") {
        void (async () => {
          try {
            await getBle().setPower(command.value === "on");
            setStatusMessage(`Lights ${command.value}.`);
          } catch (error) {
            setStatusMessage(`Power failed: ${getErrorMessage(error)}`);
          }
        })();
        return;
      }

      const hsv = hexToHsv(command.value);
      const next = normalizeLight({
        ...(command.area === "area2" ? area2 : area1),
        hue: hsv.h,
        saturation: hsv.s,
        value: hsv.v,
      });

      if (command.area === "both") {
        applyPair(next, next, normalizeHex(command.value));
        return;
      }

      setActiveTarget(command.area);
      if (command.area === "area1") {
        setArea1(next);
      } else {
        setArea2(next);
      }
      void getBle().sendArea(command.area, next);
      setStatusMessage(`Siri: ${normalizeHex(command.value)} on ${command.area}.`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device, area1, area2, getBle],
  );

  // Drain whatever Siri left behind, on launch and every time the app comes forward.
  useEffect(() => {
    const drain = () => {
      void consumeSiriCommand().then((command) => {
        if (command) {
          runSiriCommand(command);
        }
      });
    };

    drain();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        drain();
      }
    });

    return () => subscription.remove();
  }, [runSiriCommand]);

  // Reconnect on our own to the controller last used. Without this a Siri command opens the
  // app to a disconnected screen and nothing happens.
  useEffect(() => {
    if (!hydrated || device || isConnecting || !lastDeviceId) {
      return;
    }

    let cancelled = false;
    const ble = getBle();

    ble.startScan((scanned) => {
      if (cancelled || scanned.id !== lastDeviceId) {
        return;
      }

      cancelled = true;
      ble.stopScan();
      void handleConnect(scanned);
    });

    const stop = setTimeout(() => {
      cancelled = true;
      ble.stopScan();
    }, 15000);

    return () => {
      cancelled = true;
      clearTimeout(stop);
      ble.stopScan();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, device, lastDeviceId]);

  // Replay a command that arrived while disconnected.
  useEffect(() => {
    if (!device || !pendingSiriRef.current) {
      return;
    }

    const queued = pendingSiriRef.current;
    pendingSiriRef.current = null;
    runSiriCommand(queued);
  }, [device, runSiriCommand]);

  // Hold the audio session only while the phone is actually computing frames. The app never
  // sleeping costs real battery, so a static colour or a chip-side breathe must not pay it.
  const needsKeepAlive =
    Boolean(device) && (isPhoneDrivenMode(area1) || isPhoneDrivenMode(area2));

  useEffect(() => {
    if (!needsKeepAlive) {
      stopKeepAlive();
      return;
    }

    startKeepAlive();
    return () => stopKeepAlive();
  }, [needsKeepAlive]);

  // Restart the loop only when something structural changes, not on every colour tweak.
  const animationKey = [
    isPhoneDrivenMode(area1) ? `1:${area1.mode}:${area1.gradientColors.length}` : "",
    isPhoneDrivenMode(area2) ? `2:${area2.mode}:${area2.gradientColors.length}` : "",
    canAddressAreas ? "zoned" : "broadcast",
  ].join("|");

  useEffect(() => {
    if (!device || !lockedProfile) {
      return;
    }

    // Without area addressing every command hits both strips, so only one area can
    // drive the animation — otherwise the two would fight over the same output.
    const targets: ControlTarget[] = canAddressAreas
      ? ([
          isPhoneDrivenMode(settingsRef.current.area1) ? "area1" : null,
          isPhoneDrivenMode(settingsRef.current.area2) ? "area2" : null,
        ].filter(Boolean) as ControlTarget[])
      : isPhoneDrivenMode(settingsRef.current.area1)
        ? ["area1"]
        : isPhoneDrivenMode(settingsRef.current.area2)
          ? ["area2"]
          : [];

    if (targets.length === 0) {
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    const ble = getBle();
    const interval = frameIntervalMs(targets.length);

    const loop = async () => {
      while (!cancelled) {
        const elapsed = Date.now() - startedAt;

        for (const target of targets) {
          if (cancelled) {
            break;
          }

          const settings = target === "area1" ? settingsRef.current.area1 : settingsRef.current.area2;
          if (!isPhoneDrivenMode(settings)) {
            continue;
          }

          try {
            await ble.sendAnimationFrame(
              canAddressAreas ? target : "both",
              computeEffectRgb(settings, elapsed),
            );
          } catch {
            // A dropped frame is not worth stopping the effect for.
          }
        }

        await new Promise<void>((resolve) => setTimeout(() => resolve(),interval));
      }
    };

    void loop();

    return () => {
      cancelled = true;
    };
  }, [device, lockedProfile, animationKey, canAddressAreas, getBle]);

  const handleStartScan = async () => {
    const ble = getBle();

    try {
      const granted = await ble.requestPermissions();
      if (!granted) {
        setStatusMessage("Bluetooth permissions were denied.");
        return;
      }

      await ble.ensureReady();
      setStatusMessage("Scanning...");
      setScanResults([]);
      setIsScanning(true);

      const seen = new Set<string>();
      ble.startScan((scanned) => {
        if (seen.has(scanned.id)) {
          return;
        }
        seen.add(scanned.id);
        setScanResults((prev) => [...prev, scanned]);
      });

      setTimeout(() => {
        ble.stopScan();
        setIsScanning(false);
      }, 20000);
    } catch (error) {
      setIsScanning(false);
      setStatusMessage(getErrorMessage(error));
    }
  };

  const handleStopScan = () => {
    getBle().stopScan();
    setIsScanning(false);
    setStatusMessage("Scan stopped.");
  };

  const handleConnect = async (targetDevice: Device) => {
    if (isConnecting) {
      return;
    }

    const ble = getBle();

    try {
      setIsConnecting(true);
      ble.stopScan();
      setIsScanning(false);
      setStatusMessage(`Connecting to ${targetDevice.name ?? targetDevice.id}...`);

      const connected = await ble.connect(targetDevice.id);
      setDevice(connected);
      setLastDeviceId(targetDevice.id);

      const table = ble.getGattTable();
      setGattEntries(table);

      // The controller locks the captured FFB0/FFB1 profile by itself during discovery.
      // Mirror that into UI state, otherwise `canAddressAreas` stays false and the effect
      // loop never starts — which is why gradient/breathe/strobe silently did nothing
      // unless a Protocol Sweep had been run first.
      const auto = ble.getLockedProfile();
      if (auto) {
        setLockedProfile(auto);
      }

      // Frames carry both areas; tell the protocol layer what each one is already showing
      // so editing one does not blank the other.
      ble.seedAreaColors(settingsRef.current.area1, settingsRef.current.area2);

      const plan = ble.buildSweepPlan();
      setSweepPlan(plan);
      setSweepIndex(-1);
      setZonePlan(ble.buildZoneSweepPlan());
      setZoneIndex(-1);
      setSweepLog([]);

      const subscribed = await ble.startNotifications((event) => {
        appendNotifyLog(
          `${shortUuid(event.characteristicUuid)}: ${event.hex}${event.text ? `  "${event.text}"` : ""}`,
        );
      });

      setStatusMessage(
        `Connected. ${table.length} characteristics, ${subscribed} notify subscriptions, ${plan.length} sweep steps.`,
      );
    } catch (error) {
      setStatusMessage(`Connect failed: ${getErrorMessage(error)}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await getBle().disconnect();
    } catch (error) {
      setStatusMessage(`Disconnect failed: ${getErrorMessage(error)}`);
    } finally {
      setDevice(null);
      setGattEntries([]);
      setSweepPlan([]);
      setSweepIndex(-1);
      setZonePlan([]);
      setZoneIndex(-1);
      setNotifyLog([]);
      setStatusMessage("Disconnected.");
    }
  };

  const runSweepStep = async (index: number) => {
    const step = sweepPlan[index];
    if (!step || !device) {
      return;
    }

    try {
      setIsBusy(true);
      setSweepIndex(index);
      setStatusMessage(`Testing step ${index + 1} of ${sweepPlan.length}. Watch the lights.`);
      await getBle().runSweepStep(step, appendSweepLog);
      setStatusMessage(`Step ${index + 1} sent. Did the lights flash RED, GREEN, then BLUE?`);
    } catch (error) {
      appendSweepLog(`  error: ${getErrorMessage(error)}`);
      setStatusMessage(`Step ${index + 1} failed: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const [autoRunning, setAutoRunning] = useState(false);
  const autoCancelRef = useRef(false);

  const startAutoSweep = () => {
    if (!device || sweepPlan.length === 0) {
      return;
    }

    autoCancelRef.current = false;
    setAutoRunning(true);

    void (async () => {
      let index = sweepIndex + 1;

      while (!autoCancelRef.current && index < sweepPlan.length) {
        await runSweepStep(index);
        if (autoCancelRef.current) {
          break;
        }
        await new Promise<void>((resolve) => setTimeout(() => resolve(),900));
        index += 1;
      }

      setAutoRunning(false);

      if (!autoCancelRef.current) {
        setStatusMessage(
          `Swept all ${sweepPlan.length} steps with no lock-in. Capture the vendor app traffic next.`,
        );
      }
    })();
  };

  const stopAutoSweep = () => {
    autoCancelRef.current = true;
    setAutoRunning(false);
    setStatusMessage("Stopped. Pick the step that made the lights react.");
  };

  const handleLockStep = (index: number) => {
    const step = sweepPlan[index];
    if (!step) {
      return;
    }

    const profile: LockedProfile = {
      serviceUuid: step.target.serviceUuid,
      characteristicUuid: step.target.characteristicUuid,
      familyId: step.familyId,
      familyLabel: step.familyLabel,
      zoneVariantId: null,
      zoneVariantLabel: null,
    };

    setLockedProfile(profile);
    const ble = getBle();
    ble.setLockedProfile(profile);
    setZonePlan(ble.buildZoneSweepPlan());
    setZoneIndex(-1);
    setSweepIndex(index);
    setStatusMessage(`Locked in ${step.familyLabel}. Now run the Area Sweep below.`);
  };

  const runZoneStep = async (index: number) => {
    const step = zonePlan[index];
    if (!step || !device) {
      return;
    }

    try {
      setIsBusy(true);
      setZoneIndex(index);
      setStatusMessage(`Area test ${index + 1} of ${zonePlan.length}.`);
      await getBle().runZoneSweepStep(step, appendSweepLog);
      setStatusMessage("Is Area 1 RED and Area 2 BLUE? If both are the same, try the next one.");
    } catch (error) {
      appendSweepLog(`  error: ${getErrorMessage(error)}`);
      setStatusMessage(`Area test failed: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleLockZoneVariant = () => {
    const step = zonePlan[zoneIndex];
    if (!step || !lockedProfile) {
      return;
    }

    const profile: LockedProfile = {
      ...lockedProfile,
      zoneVariantId: step.variantId,
      zoneVariantLabel: step.variantLabel,
    };

    setLockedProfile(profile);
    getBle().setLockedProfile(profile);
    setStatusMessage(`Area addressing locked: ${step.variantLabel}.`);
  };

  const handleClearLock = () => {
    setLockedProfile(null);
    getBle().setLockedProfile(null);
    setZonePlan([]);
    setZoneIndex(-1);
    setStatusMessage("Cleared saved protocol.");
  };

  const writableEntries = useMemo(
    () => gattEntries.filter((entry) => entry.writableWithResponse || entry.writableWithoutResponse),
    [gattEntries],
  );

  const handleSendHex = async () => {
    const bytes = parseHexBytes(hexInput);
    if (!bytes) {
      setStatusMessage("Enter hex bytes, or a bracketed command like [06ff0000].");
      return;
    }

    const entry = writableEntries[hexTargetIndex];
    if (!entry || !device) {
      setStatusMessage("Connect and pick a writable characteristic first.");
      return;
    }

    try {
      setIsBusy(true);
      await getBle().writeRawBytes(
        { serviceUuid: entry.serviceUuid, characteristicUuid: entry.characteristicUuid },
        bytes,
      );
      appendSweepLog(
        `  manual -> ${shortUuid(entry.characteristicUuid)}: ${bytes
          .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
          .join(" ")}`,
      );
      setStatusMessage(`Sent ${bytes.length} bytes to ${shortUuid(entry.characteristicUuid)}.`);
    } catch (error) {
      setStatusMessage(`Manual send failed: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const sendCommandText = useCallback(
    async (payload: { text?: string; hex?: string }, label: string) => {
      const entry = writableEntries[hexTargetIndex];
      if (!entry || !device) {
        setStatusMessage("Connect and pick a characteristic first.");
        return;
      }

      const bytes = payload.hex
        ? parseHexBytes(payload.hex)
        : payload.text
          ? Array.from(payload.text, (char) => char.charCodeAt(0) & 0xff)
          : null;

      if (!bytes || bytes.length === 0) {
        setStatusMessage(`${label}: could not build payload.`);
        return;
      }

      try {
        await getBle().writeRawBytes(
          { serviceUuid: entry.serviceUuid, characteristicUuid: entry.characteristicUuid },
          bytes,
        );
        const shown = payload.text ?? payload.hex ?? "";
        appendSweepLog(`  ${label}: ${shown} -> ${shortUuid(entry.characteristicUuid)}`);
        setStatusMessage(`Sent ${label}`);
      } catch (error) {
        setStatusMessage(`${label} failed: ${getErrorMessage(error)}`);
      }
    },
    [appendSweepLog, device, getBle, hexTargetIndex, writableEntries],
  );

  const runLabCommand = async (index: number) => {
    const command = vendorCommands[index];
    if (!command) {
      return;
    }

    setLabCommandIndex(index);
    await sendCommandText({ text: command.text, hex: command.hex }, command.label);
  };

  const startLabRun = () => {
    if (!device) {
      return;
    }

    labCancelRef.current = false;
    setLabRunning(true);

    void (async () => {
      // Always lead with the handshake and power-on the vendor app sends.
      await sendCommandText({ hex: "a5ff010005000000ff64000005ff01ff01010000" }, "A5 power on");
      await new Promise<void>((resolve) => setTimeout(() => resolve(),400));
      await sendCommandText({ hex: "a5ff010005ff0000000064000005ff01ff01010000" }, "A5 red");
      await new Promise<void>((resolve) => setTimeout(() => resolve(),400));

      let index = 2;
      while (!labCancelRef.current && index < vendorCommands.length) {
        await runLabCommand(index);
        if (labCancelRef.current) {
          break;
        }
        await new Promise<void>((resolve) => setTimeout(() => resolve(),1500));
        index += 1;
      }

      setLabRunning(false);
      if (!labCancelRef.current) {
        setStatusMessage("Ran every command. If nothing reacted, try the other characteristic.");
      }
    })();
  };

  const stopLabRun = () => {
    labCancelRef.current = true;
    setLabRunning(false);
    setStatusMessage("Stopped. Mark the command that worked.");
  };

  const markWorking = (index: number) => {
    const command = vendorCommands[index];
    const entry = writableEntries[hexTargetIndex];
    if (!command || !entry) {
      return;
    }

    const note = `${command.label}  ${command.text}  -> ${shortUuid(entry.characteristicUuid)}`;
    setWorkingCommands((prev) => (prev.includes(note) ? prev : [note, ...prev]));
    setStatusMessage(`Noted: ${note}`);
  };

  const handleSelectColor = (hex: string) => {
    const hsv = hexToHsv(hex);
    // Carry v through as well. Dropping it made every picked colour render at full value,
    // so dark shades came back washed out.
    applyAndSend({ ...activeSettings, hue: hsv.h, saturation: hsv.s, value: hsv.v });
  };

  /**
   * Wheel picks run through the vibrance curve; swatches go through handleSelectColor and
   * stay exact. `send` is false for drag frames — the interior preview tracks the finger,
   * but the write waits for release, since the BLE queue cannot take a frame per touch.
   */
  const handleWheelColor = (hex: string, send: boolean) => {
    const hsv = hexToHsv(hex);
    const next = {
      ...activeSettings,
      hue: hsv.h,
      saturation: vibrantSaturation(hsv.s),
      value: hsv.v,
    };

    if (send) {
      applyAndSend(next);
      return;
    }

    applyToActive(normalizeLight(next));
  };

  /**
   * Guarded on a real touch: the picker also fires its callbacks from `animate()` whenever
   * its `color` prop changes, so an unguarded version would answer its own echo and the two
   * could ping-pong on hex/HSV rounding.
   */
  const handleDragColor = (hex: string) => {
    if (!draggingRef.current) {
      return;
    }

    handleWheelColor(hex, false);
  };

  const handleSavePaletteColor = () => {
    const next = normalizeHex(currentColor);

    if (builtInColors.has(next)) {
      setStatusMessage(`${next} is already a built-in colour.`);
      return;
    }

    setSavedPalette((prev) => (prev.includes(next) ? prev : [next, ...prev].slice(0, 20)));
    setStatusMessage(`Saved ${next}.`);
  };

  const currentStep = sweepIndex >= 0 ? sweepPlan[sweepIndex] : null;
  const currentZoneStep = zoneIndex >= 0 ? zonePlan[zoneIndex] : null;

  const renderSwatch = (color: string, deletable = false) => {
    const isSelected = normalizeHex(color) === normalizeHex(currentColor);

    return (
      <Pressable
        key={color}
        style={[styles.swatch, { backgroundColor: color }, isSelected ? styles.swatchActive : null]}
        onPress={() => handleSelectColor(color)}
        onLongPress={() => {
          if (deletable) {
            setSavedPalette((prev) => prev.filter((saved) => saved !== color));
          }
        }}
        delayLongPress={400}
      />
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.container} scrollEnabled={!pickerActive}>
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>{device ? "Connected" : "Not Connected"}</Text>
          <Text style={styles.heroSubtitle}>{device?.name ?? device?.id ?? "No controller"}</Text>
          <Text style={styles.buildStamp}>Build: {BUILD_LABEL}</Text>
          {lockedProfile ? (
            <>
              <Text style={styles.heroLocked}>
                Protocol: {lockedProfile.familyLabel} → {shortUuid(lockedProfile.characteristicUuid)}
              </Text>
              <Text style={canAddressAreas ? styles.heroLocked : styles.heroWarn}>
                {canAddressAreas
                  ? `Areas: ${lockedProfile.zoneVariantLabel}`
                  : "Areas: not identified — both strips change together"}
              </Text>
            </>
          ) : (
            <Text style={styles.heroWarn}>No protocol identified yet — run the sweep below.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>1. Connect</Text>
          <View style={styles.row}>
            <Pressable style={styles.actionButton} onPress={() => void handleStartScan()}>
              <Text style={styles.actionText}>Scan</Text>
            </Pressable>
            <Pressable style={styles.actionButtonSecondary} onPress={handleStopScan}>
              <Text style={styles.actionText}>Stop</Text>
            </Pressable>
            <Pressable style={styles.actionButtonSecondary} onPress={() => void handleDisconnect()}>
              <Text style={styles.actionText}>Disconnect</Text>
            </Pressable>
          </View>

          {isScanning || isConnecting ? <ActivityIndicator color="#66f2cf" /> : null}

          <View style={styles.scanList}>
            {scanResults.map((scanned) => (
              <Pressable
                key={scanned.id}
                style={styles.deviceRow}
                disabled={isConnecting}
                onPress={() => void handleConnect(scanned)}
              >
                <Text style={styles.deviceTitle}>{scanned.name ?? "Unnamed Device"}</Text>
                <Text style={styles.deviceMeta}>{scanned.id}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {SHOW_DEV_TOOLS ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Protocol Sweep</Text>
          <Text style={styles.helperText}>
            Each step sends one protocol to one characteristic, flashing RED → GREEN → BLUE.
            When your lights follow that sequence, press “This One Worked”.
          </Text>

          {sweepPlan.length === 0 ? (
            <Text style={styles.helperText}>Connect a device to build the sweep plan.</Text>
          ) : (
            <>
              <View style={styles.stepCard}>
                <Text style={styles.stepCounter}>
                  {currentStep ? `Step ${sweepIndex + 1} of ${sweepPlan.length}` : `${sweepPlan.length} steps ready`}
                </Text>
                <Text style={styles.stepFamily}>{currentStep?.familyLabel ?? "Press Test Next to start"}</Text>
                {currentStep ? (
                  <Text style={styles.stepTarget}>
                    {shortUuid(currentStep.target.serviceUuid)} → {shortUuid(currentStep.target.characteristicUuid)}
                  </Text>
                ) : null}
              </View>

              {autoRunning ? (
                <Pressable style={styles.stopButton} onPress={stopAutoSweep}>
                  <Text style={styles.bigButtonText}>■ STOP — I SAW SOMETHING</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.bigButton, isBusy || !device ? styles.bigButtonDisabled : null]}
                  disabled={isBusy || !device}
                  onPress={startAutoSweep}
                >
                  <Text style={styles.bigButtonText}>
                    {sweepIndex < 0 ? "▶ Start Auto Sweep" : "▶ Resume Auto Sweep"}
                  </Text>
                </Pressable>
              )}

              {!autoRunning ? (
                <View style={styles.row}>
                  <Pressable
                    style={styles.actionButtonSecondary}
                    disabled={isBusy || !device}
                    onPress={() => void runSweepStep(Math.min(sweepIndex + 1, sweepPlan.length - 1))}
                  >
                    <Text style={styles.actionText}>Step Once</Text>
                  </Pressable>
                  <Pressable
                    style={styles.actionButtonSecondary}
                    disabled={isBusy || sweepIndex < 0}
                    onPress={() => void runSweepStep(sweepIndex)}
                  >
                    <Text style={styles.actionText}>Repeat</Text>
                  </Pressable>
                  <Pressable
                    style={styles.actionButtonSecondary}
                    disabled={isBusy || sweepIndex < 0}
                    onPress={() => {
                      setSweepIndex(-1);
                      setStatusMessage("Sweep reset to the start.");
                    }}
                  >
                    <Text style={styles.actionText}>Restart</Text>
                  </Pressable>
                </View>
              ) : null}

              {!autoRunning && sweepIndex >= 0 ? (
                <View style={styles.pickerBlock}>
                  <Text style={styles.helperText}>
                    Which step made the lights react? The one you noticed may be a step or two back.
                  </Text>
                  {[0, 1, 2].map((back) => {
                    const index = sweepIndex - back;
                    const step = sweepPlan[index];
                    if (!step) {
                      return null;
                    }

                    return (
                      <Pressable
                        key={index}
                        style={back === 0 ? styles.successButton : styles.pickerButton}
                        onPress={() => handleLockStep(index)}
                      >
                        <Text style={styles.pickerText}>
                          Step {index + 1}: {step.familyLabel} → {shortUuid(step.target.characteristicUuid)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {lockedProfile ? (
                <Pressable style={styles.actionButtonSecondary} onPress={handleClearLock}>
                  <Text style={styles.actionText}>Clear Saved Protocol</Text>
                </Pressable>
              ) : null}
            </>
          )}

          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
        ) : null}

        {SHOW_DEV_TOOLS && lockedProfile ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Area Sweep</Text>
            <Text style={styles.helperText}>
              Finds how your controller addresses each strip separately. Each step drives
              Area 1 RED and Area 2 BLUE. When the two areas show different colours,
              press “This One Worked”.
            </Text>

            {zonePlan.length === 0 ? (
              <Text style={styles.helperText}>
                This protocol has no known area-addressing variants. Both strips will change together.
              </Text>
            ) : (
              <>
                <View style={styles.stepCard}>
                  <Text style={styles.stepCounter}>
                    {currentZoneStep
                      ? `Area test ${zoneIndex + 1} of ${zonePlan.length}`
                      : `${zonePlan.length} encodings to try`}
                  </Text>
                  <Text style={styles.stepFamily}>
                    {currentZoneStep?.variantLabel ?? "Press Test Next to start"}
                  </Text>
                  <Text style={styles.stepTarget}>Area 1 → RED, Area 2 → BLUE</Text>
                </View>

                <Pressable
                  style={[styles.bigButton, isBusy ? styles.bigButtonDisabled : null]}
                  disabled={isBusy || !device}
                  onPress={() => void runZoneStep(Math.min(zoneIndex + 1, zonePlan.length - 1))}
                >
                  <Text style={styles.bigButtonText}>{isBusy ? "Sending..." : "Test Next Area Encoding"}</Text>
                </Pressable>

                <View style={styles.row}>
                  <Pressable
                    style={styles.actionButtonSecondary}
                    disabled={isBusy || zoneIndex < 0}
                    onPress={() => void runZoneStep(zoneIndex)}
                  >
                    <Text style={styles.actionText}>Repeat</Text>
                  </Pressable>
                  <Pressable
                    style={styles.actionButtonSecondary}
                    disabled={isBusy || zoneIndex <= 0}
                    onPress={() => void runZoneStep(zoneIndex - 1)}
                  >
                    <Text style={styles.actionText}>Back</Text>
                  </Pressable>
                </View>

                <Pressable
                  style={[styles.successButton, zoneIndex < 0 ? styles.bigButtonDisabled : null]}
                  disabled={zoneIndex < 0}
                  onPress={handleLockZoneVariant}
                >
                  <Text style={styles.bigButtonText}>✓ This One Worked</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}

        {SHOW_DEV_TOOLS ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Command Lab</Text>
          <Text style={styles.helperText}>
            Commands taken from the vendor app. Pick a characteristic, then run them and
            watch the strips. Tap “That Worked” on anything that gets a reaction.
          </Text>

          <View style={styles.row}>
            {writableEntries.map((entry, index) => (
              <Pressable
                key={`lab-${entry.serviceUuid}-${entry.characteristicUuid}`}
                style={[styles.zoneButton, hexTargetIndex === index ? styles.zoneActive : null]}
                onPress={() => setHexTargetIndex(index)}
              >
                <Text
                  style={[
                    styles.zoneButtonText,
                    hexTargetIndex === index ? styles.zoneButtonTextActive : null,
                  ]}
                >
                  {shortUuid(entry.characteristicUuid)}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.stepCard}>
            <Text style={styles.stepCounter}>
              {labCommandIndex >= 0
                ? `Command ${labCommandIndex + 1} of ${vendorCommands.length}`
                : `${vendorCommands.length} commands ready`}
            </Text>
            <Text style={styles.stepFamily}>
              {labCommandIndex >= 0 ? vendorCommands[labCommandIndex].label : "Press Run All to start"}
            </Text>
            <Text style={styles.stepTarget}>
              {labCommandIndex >= 0
                ? vendorCommands[labCommandIndex].text ?? vendorCommands[labCommandIndex].hex ?? ""
                : "A5 power-on sent first"}
            </Text>
          </View>

          {labRunning ? (
            <Pressable style={styles.stopButton} onPress={stopLabRun}>
              <Text style={styles.bigButtonText}>■ STOP — I SAW SOMETHING</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.bigButton, !device ? styles.bigButtonDisabled : null]}
              disabled={!device}
              onPress={startLabRun}
            >
              <Text style={styles.bigButtonText}>▶ Run All Commands</Text>
            </Pressable>
          )}

          {!labRunning && labCommandIndex >= 0 ? (
            <View style={styles.pickerBlock}>
              <Text style={styles.helperText}>Which one got a reaction?</Text>
              {[0, 1, 2].map((back) => {
                const index = labCommandIndex - back;
                const command = vendorCommands[index];
                if (!command) {
                  return null;
                }

                return (
                  <Pressable
                    key={`mark-${index}`}
                    style={back === 0 ? styles.successButton : styles.pickerButton}
                    onPress={() => markWorking(index)}
                  >
                    <Text style={styles.pickerText}>
                      ★ {command.label}  {command.text ?? command.hex}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.sectionSubtitle}>Send individually</Text>
          <View style={styles.row}>
            {vendorCommands.map((command, index) => (
              <Pressable
                key={command.label}
                style={[styles.modeButton, labCommandIndex === index ? styles.modeActive : null]}
                disabled={!device || labRunning}
                onPress={() => void runLabCommand(index)}
              >
                <Text style={styles.modeText}>{command.label}</Text>
              </Pressable>
            ))}
          </View>

          {workingCommands.length > 0 ? (
            <>
              <Text style={styles.sectionSubtitle}>Marked as working</Text>
              {workingCommands.map((note) => (
                <Text key={note} style={styles.workingLine}>★ {note}</Text>
              ))}
            </>
          ) : null}

          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>2. Presets</Text>

          <InteriorPreview
            area1Color={area1Color}
            area2Color={area2Color}
            activeTarget={activeTarget}
            onSelectArea={setActiveTarget}
          />

          <View style={styles.grid}>
            {BUILT_IN_THEMES.map((theme) => {
              const selected = activeThemeId === theme.id;

              return (
                <Pressable
                  key={theme.id}
                  style={[styles.themeChip, selected ? styles.themeChipActive : null]}
                  onPress={() => handleApplyTheme(theme)}
                >
                  <View style={styles.themeSwatch}>
                    <View style={[styles.themeHalf, { backgroundColor: theme.area1.hex }]} />
                    <View style={[styles.themeHalf, { backgroundColor: theme.area2.hex }]} />
                  </View>
                  <Text style={[styles.themeName, selected ? styles.themeNameActive : null]}>
                    {theme.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.row}>
            <Pressable style={styles.actionButton} onPress={handleSwapAreas}>
              <Text style={styles.actionText}>⇄ Swap Areas</Text>
            </Pressable>
          </View>
          <Text style={styles.helperText}>
            {BUILT_IN_THEMES.find((theme) => theme.id === activeThemeId)?.hint ??
              "Each preset sets both areas at once. Left half of the chip is the door lines, right half the vents."}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>3. Light Control</Text>

          <View style={styles.row}>
            {targetOptions.map((option) => (
              <Pressable
                key={option.key}
                style={[styles.zoneButton, activeTarget === option.key ? styles.zoneActive : null]}
                onPress={() => setActiveTarget(option.key)}
              >
                <Text
                  style={[
                    styles.zoneButtonText,
                    activeTarget === option.key ? styles.zoneButtonTextActive : null,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {!canAddressAreas ? (
            <Text style={styles.warnText}>
              Area addressing not identified yet — commands go to both strips. Run the Area Sweep above.
            </Text>
          ) : null}

          <View style={styles.areaRow}>
            <View style={[styles.areaCard, activeTarget !== "area2" ? styles.areaCardActive : null]}>
              <View style={[styles.areaSwatch, { backgroundColor: area1Color }]} />
              <View style={styles.areaTextWrap}>
                <Text style={styles.areaLabel}>Area 1</Text>
                <Text style={styles.areaValue}>
                  {normalizeHex(area1Color)} · {Math.round(area1.brightness)}%
                </Text>
              </View>
            </View>
            <View style={[styles.areaCard, activeTarget !== "area1" ? styles.areaCardActive : null]}>
              <View style={[styles.areaSwatch, { backgroundColor: area2Color }]} />
              <View style={styles.areaTextWrap}>
                <Text style={styles.areaLabel}>Area 2</Text>
                <Text style={styles.areaValue}>
                  {normalizeHex(area2Color)} · {Math.round(area2.brightness)}%
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.wheelCard}>
            <View
              style={styles.wheelBox}
              onStartShouldSetResponderCapture={(event) => {
                // The wheel is a circle in a square box, so roughly a fifth of the box is
                // dead corner. Claiming those too would stop the page scrolling for no
                // reason — only a touch that lands on the wheel itself locks the scroll.
                const radius = WHEEL_SIZE / 2;
                const dx = event.nativeEvent.locationX - radius;
                const dy = event.nativeEvent.locationY - radius;

                if (dx * dx + dy * dy > radius * radius) {
                  return false;
                }

                wheelSeedRef.current = currentColor;
                draggingRef.current = true;
                setPickerActive(true);
                return false;
              }}
              onTouchEnd={() => {
                draggingRef.current = false;
                setPickerActive(false);
              }}
              onTouchCancel={() => {
                draggingRef.current = false;
                setPickerActive(false);
              }}
            >
              <ColorPicker
                style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
                // Frozen mid-drag. The picker animates its thumb back to this prop whenever
                // it changes, so feeding the live drag colour in here would have it fighting
                // the finger. It resumes tracking state the moment the touch ends.
                color={pickerActive ? wheelSeedRef.current : currentColor}
                onColorChange={handleDragColor}
                onColorChangeComplete={(finalColor: string) => {
                  if (!draggingRef.current) {
                    return;
                  }

                  draggingRef.current = false;
                  setPickerActive(false);
                  handleWheelColor(finalColor, true);
                }}
                thumbSize={34}
                sliderHidden
                swatches={false}
                noSnap
                gapSize={0}
                useNativeDriver={false}
              />
            </View>
            <Text style={styles.wheelValue}>{normalizeHex(currentColor)}</Text>

            {/* The wheel is nearly a full screen tall, so the preview at the top of Presets
                has long since scrolled away by the time a colour is being picked. This one
                rides with the wheel, below it, where a thumb on the wheel cannot cover it. */}
            <InteriorPreview
              area1Color={area1Color}
              area2Color={area2Color}
              activeTarget={activeTarget}
              hideLegend
            />
          </View>

          {/* Built-ins first and read-only, then yours. Long-press deletes, which is why the
              two groups have to stay distinguishable even though they share a grid. */}
          <View style={styles.grid}>
            {presetColors.map((color) => renderSwatch(color))}
            {customPalette.map((color) => renderSwatch(color, true))}
          </View>
          <View style={styles.row}>
            <Pressable style={styles.actionButton} onPress={handleSavePaletteColor}>
              <Text style={styles.actionText}>+ Save Current Colour</Text>
            </Pressable>
          </View>
          <Text style={styles.helperText}>
            The first {presetColors.length} are built in. Long-press one you saved to remove it.
          </Text>

          <Text style={styles.sliderLabel}>Brightness ({Math.round(activeSettings.brightness)}%)</Text>
          <Slider
            minimumValue={0}
            maximumValue={100}
            value={activeSettings.brightness}
            minimumTrackTintColor="#45f0b6"
            maximumTrackTintColor="#425461"
            onValueChange={(value) => applyToActive({ ...activeSettings, brightness: value })}
            onSlidingComplete={(value) => applyAndSend({ ...activeSettings, brightness: value })}
          />

          <Text style={styles.sliderLabel}>Mode</Text>
          <Text style={styles.helperText}>
            Breathe runs on the controller, so it keeps going with the app closed. Gradient and
            strobe are computed on the phone and stop when you leave the app.
          </Text>
          <View style={styles.row}>
            {modeOptions.map((mode) => (
              <Pressable
                key={mode}
                style={[styles.modeButton, activeSettings.mode === mode ? styles.modeActive : null]}
                onPress={() => applyAndSend({ ...activeSettings, mode })}
              >
                <Text style={styles.modeText}>{mode}</Text>
              </Pressable>
            ))}
          </View>

          {activeSettings.mode === "gradient" ? (
            <View style={styles.gradientBlock}>
              <Text style={styles.helperText}>
                The phone cycles these colours and fades between them. Tap a chip to remove it.
                {activeSettings.gradientColors.length < 2
                  ? " Add at least 2 colours to start."
                  : ""}
              </Text>
              <View style={styles.row}>
                {activeSettings.gradientColors.map((color) => (
                  <Pressable
                    key={color}
                    style={[styles.gradientChip, { backgroundColor: color }]}
                    onPress={() => handleRemoveGradientColor(color)}
                  >
                    <Text style={styles.gradientChipText}>×</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.actionButton} onPress={handleAddGradientColor}>
                <Text style={styles.actionText}>Add Current Colour</Text>
              </Pressable>
            </View>
          ) : null}

          <Text style={styles.sliderLabel}>Effect Speed: {speedLabels[activeSettings.speed]}</Text>
          <Slider
            minimumValue={1}
            maximumValue={5}
            step={1}
            value={activeSettings.speed}
            minimumTrackTintColor="#45f0b6"
            maximumTrackTintColor="#425461"
            onValueChange={(value) =>
              applyToActive({ ...activeSettings, speed: value as LightSettings["speed"] })
            }
            onSlidingComplete={(value) =>
              applyAndSend({ ...activeSettings, speed: value as LightSettings["speed"] })
            }
          />

        </View>

        {SHOW_DEV_TOOLS ? (
        <View style={styles.card}>
          <Pressable onPress={() => setShowDiagnostics((prev) => !prev)}>
            <Text style={styles.sectionTitle}>Diagnostics {showDiagnostics ? "▾" : "▸"}</Text>
          </Pressable>

          {showDiagnostics ? (
            <>
              <Text style={styles.sectionSubtitle}>Build</Text>
              <Text style={styles.monoLine}>{BUILD_LABEL}</Text>
              <Text style={styles.monoLine}>
                sweep steps: {sweepPlan.length} · zone variants: {zonePlan.length}
              </Text>

              <Text style={styles.sectionSubtitle}>Manual hex send</Text>
              <Text style={styles.helperText}>
                Paste captured bytes and send them straight to the controller.
              </Text>
              <TextInput
                style={styles.hexInput}
                value={hexInput}
                onChangeText={setHexInput}
                autoCapitalize="characters"
                autoCorrect={false}
                multiline
                placeholder="[06ff0000]  or  7E 00 05 03 FF 00 00 00 EF"
                placeholderTextColor="#6C7CA4"
              />
              <View style={styles.row}>
                {writableEntries.map((entry, index) => (
                  <Pressable
                    key={`${entry.serviceUuid}-${entry.characteristicUuid}`}
                    style={[styles.modeButton, hexTargetIndex === index ? styles.modeActive : null]}
                    onPress={() => setHexTargetIndex(index)}
                  >
                    <Text style={styles.modeText}>{shortUuid(entry.characteristicUuid)}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                style={[styles.actionButton, isBusy || !device ? styles.bigButtonDisabled : null]}
                disabled={isBusy || !device}
                onPress={() => void handleSendHex()}
              >
                <Text style={styles.actionText}>Send Bytes</Text>
              </Pressable>

              <Text style={styles.sectionSubtitle}>GATT table ({gattEntries.length})</Text>
              {gattEntries.length === 0 ? (
                <Text style={styles.helperText}>Connect to populate.</Text>
              ) : (
                gattEntries.map((entry) => (
                  <Text key={`${entry.serviceUuid}-${entry.characteristicUuid}`} style={styles.monoLine}>
                    {describeGattEntry(entry)}
                  </Text>
                ))
              )}

              <Text style={styles.sectionSubtitle}>Incoming notifications ({notifyLog.length})</Text>
              {notifyLog.length === 0 ? (
                <Text style={styles.helperText}>
                  Nothing received yet. Any reply here means the controller understood a command.
                </Text>
              ) : (
                notifyLog.map((line, index) => (
                  <Text key={`${line}-${index}`} style={styles.monoLine}>
                    {line}
                  </Text>
                ))
              )}

              <Text style={styles.sectionSubtitle}>Sweep log</Text>
              {sweepLog.map((line, index) => (
                <Text key={`${line}-${index}`} style={styles.monoLine}>
                  {line}
                </Text>
              ))}
            </>
          ) : null}
        </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#151B2E",
  },
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 14,
  },
  heroCard: {
    borderRadius: 20,
    backgroundColor: "#242E4D",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 3,
  },
  heroTitle: {
    color: "#F8FCFF",
    fontSize: 22,
    fontWeight: "700",
  },
  heroSubtitle: {
    color: "#C9D3ED",
    fontSize: 13,
  },
  heroLocked: {
    color: "#66F2CF",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  heroWarn: {
    color: "#FFC46B",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 3,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2C3654",
    backgroundColor: "#1C2440",
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: "#E8EEFF",
    fontWeight: "700",
    fontSize: 17,
  },
  sectionSubtitle: {
    color: "#8FA0C8",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 8,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  actionButton: {
    backgroundColor: "#1E82F4",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionButtonSecondary: {
    backgroundColor: "#3A4566",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionText: {
    color: "#F8FCFF",
    fontWeight: "700",
    fontSize: 12,
    textTransform: "uppercase",
  },
  helperText: {
    color: "#8B9AC0",
    fontSize: 12,
    lineHeight: 17,
  },
  warnText: {
    color: "#FFC46B",
    fontSize: 12,
    lineHeight: 17,
  },
  statusText: {
    color: "#C9D6F2",
    fontSize: 13,
    marginTop: 6,
  },
  scanList: {
    gap: 8,
  },
  deviceRow: {
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#333F63",
    backgroundColor: "#232C4C",
  },
  deviceTitle: {
    color: "#E6ECFB",
    fontSize: 15,
    fontWeight: "600",
  },
  deviceMeta: {
    color: "#8494BA",
    fontSize: 11,
    marginTop: 2,
  },
  stepCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#3B4874",
    backgroundColor: "#232D52",
    padding: 14,
    gap: 4,
  },
  stepCounter: {
    color: "#8FA0C8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  stepFamily: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
  },
  stepTarget: {
    color: "#9DB2E0",
    fontSize: 13,
  },
  bigButton: {
    backgroundColor: "#1E82F4",
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
  },
  bigButtonDisabled: {
    opacity: 0.45,
  },
  successButton: {
    backgroundColor: "#17A673",
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: "center",
  },
  bigButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
  },
  zoneButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3B4874",
    backgroundColor: "#232D52",
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  zoneActive: {
    borderColor: "#1D7DF0",
    backgroundColor: "#1D7DF0",
  },
  zoneButtonText: {
    color: "#A8B7DA",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  zoneButtonTextActive: {
    color: "#FFFFFF",
  },
  areaRow: {
    flexDirection: "row",
    gap: 8,
  },
  areaCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333F63",
    backgroundColor: "#232C4C",
    paddingHorizontal: 10,
    paddingVertical: 9,
    opacity: 0.55,
  },
  areaCardActive: {
    borderColor: "#77A8F0",
    opacity: 1,
  },
  areaSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3B4874",
  },
  areaTextWrap: {
    flex: 1,
  },
  areaLabel: {
    color: "#8FA0C8",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  areaValue: {
    color: "#DCE5F8",
    fontSize: 12,
    fontWeight: "700",
  },
  wheelCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    gap: 8,
  },
  /**
   * react-native-wheel-color-picker derives the wheel radius from its parent's onLayout.
   * Inside a centred flex container an unsized wrapper measures as zero, which collapses the
   * wheel and everything rendered after it. Explicit pixels, always.
   */
  wheelBox: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelValue: {
    color: "#E4EBFB",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 8,
  },
  sliderLabel: {
    color: "#9DACD0",
    fontSize: 13,
    marginTop: 6,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  swatch: {
    height: 32,
    width: "14%",
    minWidth: 30,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#2B3557",
  },
  swatchActive: {
    borderColor: "#FFFFFF",
    borderWidth: 3,
  },
  themeChip: {
    width: "31%",
    minWidth: 92,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#2B3557",
    backgroundColor: "#232D52",
    padding: 6,
    gap: 5,
  },
  themeChipActive: {
    borderColor: "#FFFFFF",
    backgroundColor: "#2E4A7C",
  },
  themeSwatch: {
    flexDirection: "row",
    height: 34,
    borderRadius: 8,
    overflow: "hidden",
  },
  themeHalf: {
    flex: 1,
  },
  themeName: {
    color: "#C3D0EE",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  themeNameActive: {
    color: "#FFFFFF",
  },
  modeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3B4874",
    backgroundColor: "#232D52",
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  modeActive: {
    borderColor: "#69A8F7",
    backgroundColor: "#2E4A7C",
  },
  modeText: {
    color: "#D3DDF6",
    fontSize: 12,
    textTransform: "capitalize",
    fontWeight: "700",
  },
  gradientBlock: {
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3B4874",
    backgroundColor: "#202A4B",
    padding: 10,
  },
  gradientChip: {
    borderRadius: 999,
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#4B5A85",
  },
  gradientChipText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  stopButton: {
    backgroundColor: "#C0392B",
    borderRadius: 14,
    paddingVertical: 20,
    alignItems: "center",
  },
  pickerBlock: {
    gap: 8,
    marginTop: 4,
  },
  pickerButton: {
    backgroundColor: "#3A4566",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  pickerText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 8,
  },
  buildStamp: {
    color: "#7C8CB4",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 4,
  },
  hexInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3B4874",
    backgroundColor: "#141C36",
    color: "#DCE5F8",
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
    fontFamily: "Courier",
    minHeight: 64,
  },
  workingLine: {
    color: "#66F2CF",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
  },
  monoLine: {
    color: "#9FB2DC",
    fontSize: 11,
    fontFamily: "Courier",
    lineHeight: 16,
  },
});
