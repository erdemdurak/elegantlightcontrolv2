import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Device } from "react-native-ble-plx";

import { BleAmbientController } from "./src/ble/bleAmbientController";
import type {
  AmbientMode,
  AppStateSnapshot,
  ProtocolProfile,
  SceneGroup,
  ScenePreset,
  ZoneKey,
  ZoneSettings,
} from "./src/types";
import { hexToHsv, hsvToHex } from "./src/utils/color";

const STORAGE_KEY = "ambient-light-controller-state";

const protocolProfiles: Array<{ key: ProtocolProfile; label: string; description: string }> = [
  {
    key: "json-v1",
    label: "JSON",
    description: "Universal debug profile.",
  },
  {
    key: "at-rgb-v1",
    label: "AT-RGB",
    description: "ASCII line command profile used by many budget BLE controllers.",
  },
  {
    key: "frame-v1",
    label: "Frame",
    description: "Byte-frame profile with checksum.",
  },
];

const presetColors = [
  "#FF3B30",
  "#FF6A00",
  "#FFCC00",
  "#A6E22E",
  "#2ECC71",
  "#00B894",
  "#00C8FF",
  "#3B82F6",
  "#6C5CE7",
  "#9B59B6",
  "#E84393",
  "#F8A5C2",
  "#FFFFFF",
  "#D1D8E0",
  "#8395A7",
  "#576574",
  "#FF4D4D",
  "#FF9F43",
  "#FDCB6E",
  "#55EFC4",
  "#81ECEC",
  "#74B9FF",
  "#A29BFE",
  "#FD79A8",
];

const modeOptions: AmbientMode[] = ["monochrome", "gradient", "strobe", "breathe"];

const sceneGroups: SceneGroup[] = ["Day", "Night", "Cruise", "Party", "Calm", "Custom"];

const speedLabels: Record<number, string> = {
  1: "Extra Slow",
  2: "Slow",
  3: "Normal",
  4: "Fast",
  5: "Very Fast",
};

const defaultZone: ZoneSettings = {
  hue: 200,
  saturation: 85,
  brightness: 80,
  mode: "monochrome",
  gradientColors: ["#3B82F6", "#E84393"],
  speed: 3,
};

const defaultSnapshot: AppStateSnapshot = {
  zoneA: defaultZone,
  zoneB: {
    ...defaultZone,
    hue: 10,
    gradientColors: ["#FF6A00", "#FFCC00", "#00C8FF"],
  },
  savedPalette: ["#3B82F6", "#E84393", "#FF6A00", "#00B894"],
  scenes: [],
  protocolProfile: "frame-v1",
  autoSendEnabled: false,
  autoSendIntervalMs: 350,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeZone(zone: ZoneSettings): ZoneSettings {
  const uniqueGradient = Array.from(new Set(zone.gradientColors));
  const fallbackGradient = uniqueGradient.length > 0 ? uniqueGradient : ["#3B82F6", "#E84393"];

  return {
    hue: clamp(zone.hue, 0, 360),
    saturation: clamp(zone.saturation, 0, 100),
    brightness: clamp(zone.brightness, 0, 100),
    mode: zone.mode,
    gradientColors: fallbackGradient.slice(0, 5),
    speed: clamp(Math.round(zone.speed), 1, 5) as ZoneSettings["speed"],
  };
}

function normalizeScene(scene: ScenePreset): ScenePreset {
  const group = scene.group ?? "Custom";

  return {
    ...scene,
    group,
    zoneA: normalizeZone(scene.zoneA),
    zoneB: normalizeZone(scene.zoneB),
  };
}

function normalizeSnapshot(snapshot: AppStateSnapshot): AppStateSnapshot {
  return {
    zoneA: normalizeZone(snapshot.zoneA),
    zoneB: normalizeZone(snapshot.zoneB),
    savedPalette: Array.from(new Set(snapshot.savedPalette)).slice(0, 20),
    scenes: (snapshot.scenes ?? []).map(normalizeScene).slice(0, 30),
    protocolProfile: snapshot.protocolProfile ?? "frame-v1",
    autoSendEnabled: snapshot.autoSendEnabled ?? false,
    autoSendIntervalMs: clamp(snapshot.autoSendIntervalMs ?? 350, 120, 1500),
  };
}

function canSendZone(zone: ZoneSettings): boolean {
  return !(zone.mode === "gradient" && zone.gradientColors.length < 2);
}

export default function App() {
  const bleRef = useRef(new BleAmbientController());
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [zoneA, setZoneA] = useState<ZoneSettings>(defaultSnapshot.zoneA);
  const [zoneB, setZoneB] = useState<ZoneSettings>(defaultSnapshot.zoneB);
  const [savedPalette, setSavedPalette] = useState<string[]>(defaultSnapshot.savedPalette);
  const [scenes, setScenes] = useState<ScenePreset[]>(defaultSnapshot.scenes ?? []);
  const [activeZone, setActiveZone] = useState<ZoneKey>("zoneA");

  const [protocolProfile, setProtocolProfile] = useState<ProtocolProfile>(
    defaultSnapshot.protocolProfile ?? "frame-v1",
  );

  const [serviceUuid, setServiceUuid] = useState("0000FFE0-0000-1000-8000-00805F9B34FB");
  const [characteristicUuid, setCharacteristicUuid] = useState("0000FFE1-0000-1000-8000-00805F9B34FB");
  const [scanResults, setScanResults] = useState<Device[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready");

  const [autoSendEnabled, setAutoSendEnabled] = useState(defaultSnapshot.autoSendEnabled ?? false);
  const [autoSendIntervalMs, setAutoSendIntervalMs] = useState(defaultSnapshot.autoSendIntervalMs ?? 350);
  const [sceneName, setSceneName] = useState("");
  const [sceneGroupDraft, setSceneGroupDraft] = useState<SceneGroup>("Custom");

  useEffect(() => {
    const load = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!stored) {
          return;
        }

        const parsed = JSON.parse(stored) as AppStateSnapshot;
        const normalized = normalizeSnapshot(parsed);
        setZoneA(normalized.zoneA);
        setZoneB(normalized.zoneB);
        setSavedPalette(normalized.savedPalette);
        setScenes(normalized.scenes ?? []);
        setProtocolProfile(normalized.protocolProfile ?? "frame-v1");
        setAutoSendEnabled(normalized.autoSendEnabled ?? false);
        setAutoSendIntervalMs(normalized.autoSendIntervalMs ?? 350);
      } catch {
        setStatusMessage("Could not load saved state. Using defaults.");
      }
    };

    void load();
  }, []);

  useEffect(() => {
    const persist = async () => {
      const payload: AppStateSnapshot = {
        zoneA,
        zoneB,
        savedPalette,
        scenes,
        protocolProfile,
        autoSendEnabled,
        autoSendIntervalMs,
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    };

    void persist();
  }, [zoneA, zoneB, savedPalette, scenes, protocolProfile, autoSendEnabled, autoSendIntervalMs]);

  useEffect(() => {
    return () => {
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current);
      }
      bleRef.current.stopScan();
      bleRef.current.destroy();
    };
  }, []);

  const currentZoneSettings = activeZone === "zoneA" ? zoneA : zoneB;

  const currentColor = useMemo(
    () => hsvToHex(currentZoneSettings.hue, currentZoneSettings.saturation, currentZoneSettings.brightness),
    [currentZoneSettings.brightness, currentZoneSettings.hue, currentZoneSettings.saturation],
  );

  const connectedDevice = bleRef.current.getConnectedDevice();

  const updateActiveZone = (next: (zone: ZoneSettings) => ZoneSettings) => {
    if (activeZone === "zoneA") {
      setZoneA((prev) => normalizeZone(next(prev)));
      return;
    }

    setZoneB((prev) => normalizeZone(next(prev)));
  };

  const sendZone = async (
    zoneKey: ZoneKey,
    options?: {
      quiet?: boolean;
    },
  ) => {
    const selectedZone = zoneKey === "zoneA" ? zoneA : zoneB;

    if (!canSendZone(selectedZone)) {
      if (!options?.quiet) {
        setStatusMessage("Gradient mode requires at least 2 selected colors.");
      }
      return;
    }

    try {
      setIsSending(true);
      bleRef.current.setTarget(serviceUuid, characteristicUuid);
      bleRef.current.setProtocolProfile(protocolProfile);
      await bleRef.current.sendZone(zoneKey, selectedZone);

      if (!options?.quiet) {
        setStatusMessage(`Sent ${zoneKey.toUpperCase()} settings.`);
      }
    } catch (error) {
      setStatusMessage(`Send failed: ${(error as Error).message}`);
    } finally {
      setIsSending(false);
    }
  };

  const sendBothZones = async (quiet = false) => {
    if (!canSendZone(zoneA)) {
      if (!quiet) {
        setStatusMessage("Zone A gradient mode requires at least 2 colors.");
      }
      return;
    }

    if (!canSendZone(zoneB)) {
      if (!quiet) {
        setStatusMessage("Zone B gradient mode requires at least 2 colors.");
      }
      return;
    }

    try {
      setIsSending(true);
      bleRef.current.setTarget(serviceUuid, characteristicUuid);
      bleRef.current.setProtocolProfile(protocolProfile);
      await bleRef.current.sendZone("zoneA", zoneA);
      await bleRef.current.sendZone("zoneB", zoneB);

      if (!quiet) {
        setStatusMessage("Sent settings for both zones.");
      }
    } catch (error) {
      setStatusMessage(`Send failed: ${(error as Error).message}`);
    } finally {
      setIsSending(false);
    }
  };

  const runProtocolTest = async (mode: AmbientMode) => {
    const gradientSeed = currentZoneSettings.gradientColors.length >= 2
      ? currentZoneSettings.gradientColors
      : ["#FF3B30", "#00C8FF", "#FFCC00"];

    const testZone: ZoneSettings = {
      ...currentZoneSettings,
      mode,
      speed: 3,
      hue: mode === "monochrome" ? 200 : currentZoneSettings.hue,
      saturation: mode === "monochrome" ? 95 : currentZoneSettings.saturation,
      brightness: mode === "strobe" ? 100 : currentZoneSettings.brightness,
      gradientColors: gradientSeed.slice(0, 5),
    };

    if (!connectedDevice) {
      setStatusMessage("Connect a BLE device before running protocol tests.");
      return;
    }

    try {
      setIsSending(true);
      bleRef.current.setTarget(serviceUuid, characteristicUuid);
      bleRef.current.setProtocolProfile(protocolProfile);
      await bleRef.current.sendZone(activeZone, testZone);
      setStatusMessage(`Protocol test sent: ${mode} on ${activeZone.toUpperCase()}.`);
    } catch (error) {
      setStatusMessage(`Protocol test failed: ${(error as Error).message}`);
    } finally {
      setIsSending(false);
    }
  };

  const moveSceneInGroup = (sceneId: string, group: SceneGroup, direction: "up" | "down") => {
    setScenes((prev) => {
      const groupIndexes = prev
        .map((scene, index) => ({ scene, index }))
        .filter((entry) => entry.scene.group === group)
        .map((entry) => entry.index);

      const currentGroupPosition = groupIndexes.findIndex((globalIndex) => prev[globalIndex].id === sceneId);
      if (currentGroupPosition === -1) {
        return prev;
      }

      const swapGroupPosition = direction === "up" ? currentGroupPosition - 1 : currentGroupPosition + 1;
      if (swapGroupPosition < 0 || swapGroupPosition >= groupIndexes.length) {
        return prev;
      }

      const sourceGlobalIndex = groupIndexes[currentGroupPosition];
      const targetGlobalIndex = groupIndexes[swapGroupPosition];

      const next = [...prev];
      const temp = next[sourceGlobalIndex];
      next[sourceGlobalIndex] = next[targetGlobalIndex];
      next[targetGlobalIndex] = temp;
      return next;
    });
  };

  useEffect(() => {
    if (!autoSendEnabled || !connectedDevice || !canSendZone(currentZoneSettings)) {
      return;
    }

    if (autoSendTimerRef.current) {
      clearTimeout(autoSendTimerRef.current);
    }

    autoSendTimerRef.current = setTimeout(() => {
      void sendZone(activeZone, { quiet: true });
    }, autoSendIntervalMs);

    return () => {
      if (autoSendTimerRef.current) {
        clearTimeout(autoSendTimerRef.current);
      }
    };
  }, [
    activeZone,
    autoSendEnabled,
    autoSendIntervalMs,
    connectedDevice,
    currentZoneSettings,
    protocolProfile,
    serviceUuid,
    characteristicUuid,
  ]);

  const handleSelectColor = (hex: string) => {
    const hsv = hexToHsv(hex);
    updateActiveZone((zone) => ({
      ...zone,
      hue: hsv.h,
      saturation: hsv.s,
    }));
  };

  const handleAddCurrentToGradient = () => {
    updateActiveZone((zone) => {
      if (zone.gradientColors.includes(currentColor)) {
        return zone;
      }

      if (zone.gradientColors.length >= 5) {
        setStatusMessage("Gradient supports up to 5 colors.");
        return zone;
      }

      return {
        ...zone,
        gradientColors: [...zone.gradientColors, currentColor],
      };
    });
  };

  const handleRemoveGradientColor = (color: string) => {
    updateActiveZone((zone) => ({
      ...zone,
      gradientColors: zone.gradientColors.filter((item) => item !== color),
    }));
  };

  const handleSavePaletteColor = () => {
    setSavedPalette((prev) => {
      if (prev.includes(currentColor)) {
        return prev;
      }

      return [currentColor, ...prev].slice(0, 20);
    });
    setStatusMessage(`Saved ${currentColor} to palette.`);
  };

  const handleStartScan = async () => {
    const permissionsGranted = await bleRef.current.requestPermissions();
    if (!permissionsGranted) {
      setStatusMessage("Bluetooth permissions were denied.");
      return;
    }

    try {
      await bleRef.current.ensureReady();
      bleRef.current.setTarget(serviceUuid, characteristicUuid);
      bleRef.current.setProtocolProfile(protocolProfile);

      setStatusMessage("Scanning for BLE devices...");
      setScanResults([]);
      setIsScanning(true);

      const seen = new Set<string>();
      bleRef.current.startScan((device) => {
        if (seen.has(device.id)) {
          return;
        }

        seen.add(device.id);
        setScanResults((prev) => [...prev, device]);
      });
    } catch (error) {
      setStatusMessage((error as Error).message);
    }
  };

  const handleStopScan = () => {
    bleRef.current.stopScan();
    setIsScanning(false);
    setStatusMessage("Scan stopped.");
  };

  const handleConnect = async (device: Device) => {
    try {
      setStatusMessage(`Connecting to ${device.name ?? device.id}...`);
      bleRef.current.setTarget(serviceUuid, characteristicUuid);
      bleRef.current.setProtocolProfile(protocolProfile);
      await bleRef.current.connect(device.id);
      setStatusMessage(`Connected to ${device.name ?? device.id}`);
      setIsScanning(false);
      bleRef.current.stopScan();
    } catch (error) {
      setStatusMessage(`Connect failed: ${(error as Error).message}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      await bleRef.current.disconnect();
      setStatusMessage("Device disconnected.");
    } catch (error) {
      setStatusMessage(`Disconnect failed: ${(error as Error).message}`);
    }
  };

  const handleSaveScene = () => {
    const trimmed = sceneName.trim();
    if (!trimmed) {
      setStatusMessage("Please enter a scene name.");
      return;
    }

    const scene: ScenePreset = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      name: trimmed,
      group: sceneGroupDraft,
      zoneA: normalizeZone(zoneA),
      zoneB: normalizeZone(zoneB),
      createdAt: Date.now(),
    };

    setScenes((prev) => [scene, ...prev].slice(0, 30));
    setSceneName("");
    setSceneGroupDraft("Custom");
    setStatusMessage(`Saved scene: ${trimmed}`);
  };

  const handleApplyScene = (scene: ScenePreset) => {
    setZoneA(normalizeZone(scene.zoneA));
    setZoneB(normalizeZone(scene.zoneB));
    setStatusMessage(`Applied scene: ${scene.name}`);
  };

  const handleDeleteScene = (sceneId: string) => {
    setScenes((prev) => prev.filter((scene) => scene.id !== sceneId));
  };

  const groupedScenes = useMemo(() => {
    return sceneGroups
      .map((group) => ({
        group,
        scenes: scenes
          .map((scene, index) => ({ scene, index }))
          .filter(({ scene }) => scene.group === group),
      }))
      .filter((entry) => entry.scenes.length > 0);
  }, [scenes]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.kicker}>BLE AMBIENT CONTROL</Text>
        <Text style={styles.title}>Car Ambient Light Controller</Text>
        <Text style={styles.subtitle}>
          Two independent zones, custom gradient palette (2-5 colors), brightness, hue, saturation, effect modes, and named scenes.
        </Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Bluetooth</Text>
          <Text style={styles.sectionSubtitle}>Protocol Profile</Text>
          <View style={styles.row}>
            {protocolProfiles.map((profile) => (
              <Pressable
                key={profile.key}
                style={[
                  styles.modeButton,
                  protocolProfile === profile.key ? styles.modeActive : null,
                ]}
                onPress={() => setProtocolProfile(profile.key)}
              >
                <Text style={styles.modeText}>{profile.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.helperText}>
            {
              protocolProfiles.find((profile) => profile.key === protocolProfile)?.description
            }
          </Text>

          <TextInput
            style={styles.input}
            value={serviceUuid}
            onChangeText={setServiceUuid}
            autoCapitalize="characters"
            placeholder="Service UUID"
            placeholderTextColor="#7f8f9b"
          />
          <TextInput
            style={styles.input}
            value={characteristicUuid}
            onChangeText={setCharacteristicUuid}
            autoCapitalize="characters"
            placeholder="Characteristic UUID"
            placeholderTextColor="#7f8f9b"
          />

          <View style={styles.row}>
            <Pressable style={styles.actionButton} onPress={handleStartScan}>
              <Text style={styles.actionText}>Scan</Text>
            </Pressable>
            <Pressable style={styles.actionButtonSecondary} onPress={handleStopScan}>
              <Text style={styles.actionText}>Stop</Text>
            </Pressable>
            <Pressable style={styles.actionButtonSecondary} onPress={handleDisconnect}>
              <Text style={styles.actionText}>Disconnect</Text>
            </Pressable>
          </View>

          <Text style={styles.helperText}>
            Connected: {connectedDevice?.name ?? connectedDevice?.id ?? "None"}
          </Text>

          {isScanning ? <ActivityIndicator color="#66f2cf" /> : null}

          <View style={styles.scanList}>
            {scanResults.map((device) => (
              <Pressable
                key={device.id}
                style={styles.deviceRow}
                onPress={() => {
                  void handleConnect(device);
                }}
              >
                <Text style={styles.deviceTitle}>{device.name ?? "Unnamed Device"}</Text>
                <Text style={styles.deviceMeta}>{device.id}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Live Sync</Text>
          <View style={styles.row}>
            <Pressable
              style={[styles.zoneButton, autoSendEnabled ? styles.zoneActive : null]}
              onPress={() => setAutoSendEnabled((prev) => !prev)}
            >
              <Text style={styles.actionText}>{autoSendEnabled ? "Auto Send: On" : "Auto Send: Off"}</Text>
            </Pressable>
          </View>
          <Text style={styles.sliderLabel}>Throttle: {Math.round(autoSendIntervalMs)}ms</Text>
          <Slider
            minimumValue={120}
            maximumValue={1500}
            step={10}
            value={autoSendIntervalMs}
            minimumTrackTintColor="#45f0b6"
            maximumTrackTintColor="#425461"
            onValueChange={(value) => setAutoSendIntervalMs(value)}
          />
          <Text style={styles.helperText}>
            When enabled, moving sliders or changing colors sends the active zone after the throttle interval.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Protocol Tests</Text>
          <Text style={styles.helperText}>
            Sends one quick effect command to the active zone using the selected protocol profile.
          </Text>
          <View style={styles.row}>
            <Pressable
              style={styles.actionButtonSecondary}
              onPress={() => {
                void runProtocolTest("monochrome");
              }}
            >
              <Text style={styles.actionText}>Test Monochrome</Text>
            </Pressable>
            <Pressable
              style={styles.actionButtonSecondary}
              onPress={() => {
                void runProtocolTest("gradient");
              }}
            >
              <Text style={styles.actionText}>Test Gradient</Text>
            </Pressable>
            <Pressable
              style={styles.actionButtonSecondary}
              onPress={() => {
                void runProtocolTest("strobe");
              }}
            >
              <Text style={styles.actionText}>Test Strobe</Text>
            </Pressable>
            <Pressable
              style={styles.actionButtonSecondary}
              onPress={() => {
                void runProtocolTest("breathe");
              }}
            >
              <Text style={styles.actionText}>Test Breathe</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Zones</Text>
          <View style={styles.row}>
            <Pressable
              style={[styles.zoneButton, activeZone === "zoneA" ? styles.zoneActive : null]}
              onPress={() => setActiveZone("zoneA")}
            >
              <Text style={styles.actionText}>Zone A</Text>
            </Pressable>
            <Pressable
              style={[styles.zoneButton, activeZone === "zoneB" ? styles.zoneActive : null]}
              onPress={() => setActiveZone("zoneB")}
            >
              <Text style={styles.actionText}>Zone B</Text>
            </Pressable>
          </View>

          <View style={styles.previewRow}>
            <View style={[styles.colorPreview, { backgroundColor: currentColor }]} />
            <Text style={styles.colorText}>Selected: {currentColor}</Text>
          </View>

          <Text style={styles.sliderLabel}>Hue ({Math.round(currentZoneSettings.hue)})</Text>
          <Slider
            minimumValue={0}
            maximumValue={360}
            value={currentZoneSettings.hue}
            minimumTrackTintColor="#45f0b6"
            maximumTrackTintColor="#425461"
            onValueChange={(value) => {
              updateActiveZone((zone) => ({ ...zone, hue: value }));
            }}
          />

          <Text style={styles.sliderLabel}>Saturation ({Math.round(currentZoneSettings.saturation)}%)</Text>
          <Slider
            minimumValue={0}
            maximumValue={100}
            value={currentZoneSettings.saturation}
            minimumTrackTintColor="#45f0b6"
            maximumTrackTintColor="#425461"
            onValueChange={(value) => {
              updateActiveZone((zone) => ({ ...zone, saturation: value }));
            }}
          />

          <Text style={styles.sliderLabel}>Brightness ({Math.round(currentZoneSettings.brightness)}%)</Text>
          <Slider
            minimumValue={0}
            maximumValue={100}
            value={currentZoneSettings.brightness}
            minimumTrackTintColor="#45f0b6"
            maximumTrackTintColor="#425461"
            onValueChange={(value) => {
              updateActiveZone((zone) => ({ ...zone, brightness: value }));
            }}
          />

          <Text style={styles.sectionSubtitle}>Color Grid</Text>
          <View style={styles.grid}>
            {presetColors.map((color) => (
              <Pressable
                key={color}
                style={[
                  styles.swatch,
                  { backgroundColor: color },
                  color === currentColor ? styles.swatchActive : null,
                ]}
                onPress={() => handleSelectColor(color)}
              />
            ))}
          </View>

          <View style={styles.row}>
            <Pressable style={styles.actionButton} onPress={handleSavePaletteColor}>
              <Text style={styles.actionText}>Save Color</Text>
            </Pressable>
            <Pressable style={styles.actionButtonSecondary} onPress={handleAddCurrentToGradient}>
              <Text style={styles.actionText}>Add To Gradient</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionSubtitle}>Saved Palette</Text>
          <View style={styles.grid}>
            {savedPalette.map((color) => (
              <Pressable
                key={color}
                style={[
                  styles.swatch,
                  { backgroundColor: color },
                  color === currentColor ? styles.swatchActive : null,
                ]}
                onPress={() => handleSelectColor(color)}
              />
            ))}
          </View>

          <Text style={styles.sectionSubtitle}>Mode</Text>
          <View style={styles.modeRow}>
            {modeOptions.map((mode) => (
              <Pressable
                key={mode}
                style={[
                  styles.modeButton,
                  currentZoneSettings.mode === mode ? styles.modeActive : null,
                ]}
                onPress={() => {
                  updateActiveZone((zone) => ({ ...zone, mode }));
                }}
              >
                <Text style={styles.modeText}>{mode}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sliderLabel}>
            Effect Speed: {speedLabels[currentZoneSettings.speed]}
          </Text>
          <Slider
            minimumValue={1}
            maximumValue={5}
            step={1}
            value={currentZoneSettings.speed}
            minimumTrackTintColor="#45f0b6"
            maximumTrackTintColor="#425461"
            onValueChange={(value) => {
              updateActiveZone((zone) => ({ ...zone, speed: value as ZoneSettings["speed"] }));
            }}
          />

          <Text style={styles.helperText}>
            Gradient mode uses only the colors you choose (2-5), not full rainbow cycling.
          </Text>
          <View style={styles.gradientRow}>
            {currentZoneSettings.gradientColors.map((color) => (
              <Pressable
                key={color}
                style={[styles.gradientChip, { backgroundColor: color }]}
                onPress={() => handleRemoveGradientColor(color)}
              >
                <Text style={styles.gradientChipText}>x</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Scenes</Text>
          <TextInput
            style={styles.input}
            value={sceneName}
            onChangeText={setSceneName}
            placeholder="Scene name (ex: Night Cruise)"
            placeholderTextColor="#7f8f9b"
          />
          <Text style={styles.sectionSubtitle}>Group</Text>
          <View style={styles.row}>
            {sceneGroups.map((group) => (
              <Pressable
                key={group}
                style={[
                  styles.modeButton,
                  sceneGroupDraft === group ? styles.modeActive : null,
                ]}
                onPress={() => setSceneGroupDraft(group)}
              >
                <Text style={styles.modeText}>{group}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable style={styles.actionButton} onPress={handleSaveScene}>
              <Text style={styles.actionText}>Save Current Scene</Text>
            </Pressable>
            <Pressable
              style={styles.actionButtonSecondary}
              onPress={() => {
                void sendBothZones();
              }}
            >
              <Text style={styles.actionText}>Send Both Zones</Text>
            </Pressable>
          </View>

          {scenes.length === 0 ? <Text style={styles.helperText}>No scenes saved yet.</Text> : null}

          <View style={styles.scanList}>
            {groupedScenes.map(({ group, scenes: grouped }) => (
              <View key={group} style={styles.groupCard}>
                <Text style={styles.groupTitle}>{group}</Text>
                {grouped.map(({ scene, index }) => (
                  <View key={scene.id} style={styles.sceneRow}>
                    <View style={styles.sceneMeta}>
                      <Text style={styles.deviceTitle}>{scene.name}</Text>
                      <Text style={styles.deviceMeta}>
                        {new Date(scene.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <Pressable
                      style={styles.actionButtonSecondary}
                      onPress={() => handleApplyScene(scene)}
                    >
                      <Text style={styles.actionText}>Apply</Text>
                    </Pressable>
                    <Pressable
                      style={styles.actionButtonSecondary}
                      onPress={() => moveSceneInGroup(scene.id, group, "up")}
                      disabled={index === 0}
                    >
                      <Text style={styles.actionText}>Up</Text>
                    </Pressable>
                    <Pressable
                      style={styles.actionButtonSecondary}
                      onPress={() => moveSceneInGroup(scene.id, group, "down")}
                      disabled={index === grouped.length - 1}
                    >
                      <Text style={styles.actionText}>Down</Text>
                    </Pressable>
                    <Pressable
                      style={styles.deleteButton}
                      onPress={() => handleDeleteScene(scene.id)}
                    >
                      <Text style={styles.actionText}>Delete</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Send</Text>
          <View style={styles.row}>
            <Pressable
              style={styles.actionButton}
              onPress={() => {
                void sendZone(activeZone);
              }}
            >
              <Text style={styles.actionText}>Send Active Zone</Text>
            </Pressable>
            <Pressable
              style={styles.actionButtonSecondary}
              onPress={() => {
                void sendBothZones();
              }}
            >
              <Text style={styles.actionText}>Send Both Zones</Text>
            </Pressable>
          </View>

          {isSending ? <ActivityIndicator color="#66f2cf" /> : null}
          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#07141A",
  },
  container: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 14,
  },
  kicker: {
    color: "#66f2cf",
    fontSize: 12,
    letterSpacing: 1.8,
    fontWeight: "700",
  },
  title: {
    color: "#F5FCFF",
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
  },
  subtitle: {
    color: "#B6C6CF",
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2A444F",
    backgroundColor: "#102229",
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: "#E4FAFF",
    fontWeight: "700",
    fontSize: 18,
  },
  sectionSubtitle: {
    color: "#CCE8EE",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2A444F",
    backgroundColor: "#0A1B21",
    color: "#DCEEF4",
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  actionButton: {
    backgroundColor: "#18C29C",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionButtonSecondary: {
    backgroundColor: "#2A444F",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  deleteButton: {
    backgroundColor: "#7B2A2A",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionText: {
    color: "#F4FEFF",
    fontWeight: "700",
    fontSize: 12,
    textTransform: "uppercase",
  },
  helperText: {
    color: "#A7BBC6",
    fontSize: 12,
  },
  scanList: {
    gap: 8,
  },
  deviceRow: {
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#2A444F",
    backgroundColor: "#0D1E25",
  },
  deviceTitle: {
    color: "#E3F5FA",
    fontSize: 14,
    fontWeight: "600",
  },
  deviceMeta: {
    color: "#93AAB5",
    fontSize: 11,
    marginTop: 2,
  },
  zoneButton: {
    backgroundColor: "#2A444F",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  zoneActive: {
    backgroundColor: "#1B9E88",
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  colorPreview: {
    height: 40,
    width: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D8F3FF",
  },
  colorText: {
    color: "#D9ECF1",
    fontSize: 13,
    fontWeight: "600",
  },
  sliderLabel: {
    color: "#D4E8EE",
    fontSize: 13,
    marginTop: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  swatch: {
    height: 28,
    width: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#DCECF2",
  },
  swatchActive: {
    transform: [{ scale: 1.14 }],
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2E4B57",
    backgroundColor: "#0D1E25",
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  modeActive: {
    borderColor: "#55F0C5",
    backgroundColor: "#17443C",
  },
  modeText: {
    color: "#E1F2F8",
    fontSize: 12,
    textTransform: "capitalize",
    fontWeight: "700",
  },
  gradientRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  gradientChip: {
    borderRadius: 999,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#DAECF5",
  },
  gradientChipText: {
    color: "#F6FBFD",
    fontSize: 14,
    fontWeight: "900",
  },
  groupCard: {
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "#2A444F",
    backgroundColor: "#0A1A20",
    gap: 8,
  },
  groupTitle: {
    color: "#9AD8E8",
    fontWeight: "700",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  sceneRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#2A444F",
    backgroundColor: "#0D1E25",
  },
  sceneMeta: {
    flex: 1,
  },
  statusText: {
    color: "#C3D7DE",
    fontSize: 12,
  },
});
