import { BleManager, type Device, type Subscription, State } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";
import { decode, encode } from "base-64";

import type { ControlTarget, LightSettings, LockedProfile } from "../types";
import { decodeControllerStatePayload, type ParsedControllerState } from "./ambientControllerProtocol";
import {
  getProtocolFamily,
  getZoneVariant,
  protocolFamilies,
  sweepColors,
  zoneTestColors,
  type Area,
  type Payload,
  type ProtocolFamily,
  type ProtocolFamilyId,
  type Rgb,
} from "./protocolFamilies";
import { hsvToRgb } from "../utils/color";

/** Gap between consecutive BLE writes. Cheap UART bridges drop traffic sent faster than this. */
const WRITE_GAP_MS = 40;

/** Dwell between the RED / GREEN / BLUE pulses of one sweep step. */
const SWEEP_COLOR_DWELL_MS = 700;

export type GattEntry = {
  serviceUuid: string;
  characteristicUuid: string;
  readable: boolean;
  notifiable: boolean;
  writableWithResponse: boolean;
  writableWithoutResponse: boolean;
};

export type BleTarget = {
  serviceUuid: string;
  characteristicUuid: string;
};

export type SweepStep = {
  index: number;
  target: BleTarget;
  familyId: ProtocolFamilyId;
  familyLabel: string;
};

export type ZoneSweepStep = {
  index: number;
  variantId: string;
  variantLabel: string;
};

export type NotificationEvent = {
  serviceUuid: string;
  characteristicUuid: string;
  base64: string;
  hex: string;
  text: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function bytesToBase64(bytes: number[]): string {
  return encode(String.fromCharCode(...bytes.map((value) => value & 0xff)));
}

function bytesToHex(bytes: number[]): string {
  return bytes
    .map((value) => (value & 0xff).toString(16).padStart(2, "0"))
    .join(" ")
    .toUpperCase();
}

function base64ToBytes(value: string): number[] {
  let binary = "";
  try {
    binary = decode(value);
  } catch {
    return [];
  }

  const bytes: number[] = [];
  for (let index = 0; index < binary.length; index += 1) {
    bytes.push(binary.charCodeAt(index) & 0xff);
  }
  return bytes;
}

function isPrintable(bytes: number[]): boolean {
  return bytes.length > 0 && bytes.every((byte) => byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e));
}

export class BleAmbientController {
  private manager: BleManager | null = null;

  private connectedDevice: Device | null = null;

  private gattTable: GattEntry[] = [];

  private notificationSubscriptions: Subscription[] = [];

  private lockedProfile: LockedProfile | null = null;

  private writeChain: Promise<void> = Promise.resolve();

  /** Fallback target used before any GATT discovery has happened. */
  private fallbackTarget: BleTarget = {
    serviceUuid: "0000FFE0-0000-1000-8000-00805F9B34FB",
    characteristicUuid: "0000FFE1-0000-1000-8000-00805F9B34FB",
  };

  private getManager(): BleManager {
    if (!this.manager) {
      this.manager = new BleManager();
    }

    return this.manager;
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== "android") {
      return true;
    }

    if (typeof Platform.Version === "number" && Platform.Version >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);

      // Location is not required for scanning on Android 12+ when neverForLocation is declared.
      return (
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
        result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
      );
    }

    const fineLocation = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );

    return fineLocation === PermissionsAndroid.RESULTS.GRANTED;
  }

  async ensureReady(): Promise<void> {
    const manager = this.getManager();
    const state = await manager.state();
    if (state === State.PoweredOn) {
      return;
    }

    const describe = (value: State): string | null => {
      if (value === State.Unauthorized) {
        return "Bluetooth permission denied. Enable Bluetooth access in iPhone Settings and reopen the app.";
      }
      if (value === State.Unsupported) {
        return "Bluetooth LE is not supported on this device.";
      }
      if (value === State.PoweredOff) {
        return "Bluetooth is off. Please enable Bluetooth and try again.";
      }
      return null;
    };

    const immediate = describe(state);
    if (immediate) {
      throw new Error(immediate);
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        subscription.remove();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const subscription = manager.onStateChange((nextState) => {
        if (nextState === State.PoweredOn) {
          finish();
          return;
        }

        const message = describe(nextState);
        if (message) {
          finish(new Error(message));
        }
      }, true);

      const timeoutHandle = setTimeout(() => {
        finish(new Error("Bluetooth did not become ready. Please enable Bluetooth and try again."));
      }, 12000);
    });
  }

  setLockedProfile(profile: LockedProfile | null): void {
    this.lockedProfile = profile;
  }

  getLockedProfile(): LockedProfile | null {
    return this.lockedProfile;
  }

  setFallbackTarget(serviceUuid: string, characteristicUuid: string): void {
    const service = serviceUuid.trim();
    const characteristic = characteristicUuid.trim();

    if (service.length > 0 && characteristic.length > 0) {
      this.fallbackTarget = { serviceUuid: service, characteristicUuid: characteristic };
    }
  }

  startScan(onDevice: (device: Device) => void): void {
    const manager = this.getManager();
    manager.stopDeviceScan();

    manager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error || !scannedDevice) {
        return;
      }

      onDevice(scannedDevice);
    });
  }

  stopScan(): void {
    this.manager?.stopDeviceScan();
  }

  async connect(deviceId: string): Promise<Device> {
    await this.ensureReady();
    this.stopScan();
    this.clearNotifications();

    const manager = this.getManager();

    try {
      await manager.cancelDeviceConnection(deviceId);
    } catch {
      // The device may already be disconnected or not yet connected.
    }

    const connected = await manager.connectToDevice(deviceId, { timeout: 15000 });
    await connected.discoverAllServicesAndCharacteristics();

    // Larger MTU keeps multi-byte frames in a single ATT packet where supported.
    try {
      await connected.requestMTU(185);
    } catch {
      // Not supported everywhere; the default MTU still carries every frame we send.
    }

    this.connectedDevice = connected;
    await this.refreshGattTable();

    // Some firmware ignores commands until it has seen the handshake the vendor app
    // sends on connect. Best-effort: a failure here must not block connecting.
    if (this.lockedProfile) {
      try {
        const family = getProtocolFamily(this.lockedProfile.familyId);
        await this.writePayloads(family.preamble(), this.lockedTarget());
      } catch {
        // Controller does not want the handshake; carry on.
      }
    }

    return connected;
  }

  async disconnect(): Promise<void> {
    this.clearNotifications();

    if (!this.connectedDevice) {
      return;
    }

    const deviceId = this.connectedDevice.id;
    this.connectedDevice = null;
    this.gattTable = [];
    await this.getManager().cancelDeviceConnection(deviceId);
  }

  getConnectedDevice(): Device | null {
    return this.connectedDevice;
  }

  getGattTable(): GattEntry[] {
    return [...this.gattTable];
  }

  private async refreshGattTable(): Promise<void> {
    if (!this.connectedDevice) {
      this.gattTable = [];
      return;
    }

    const services = await this.connectedDevice.services();
    const entries: GattEntry[] = [];

    for (const service of services) {
      const characteristics = await service.characteristics();
      for (const characteristic of characteristics) {
        entries.push({
          serviceUuid: service.uuid,
          characteristicUuid: characteristic.uuid,
          readable: characteristic.isReadable,
          notifiable: characteristic.isNotifiable || characteristic.isIndicatable,
          writableWithResponse: characteristic.isWritableWithResponse,
          writableWithoutResponse: characteristic.isWritableWithoutResponse,
        });
      }
    }

    this.gattTable = entries;
  }

  /**
   * Subscribes to every notifiable characteristic. A number of controllers refuse to act on
   * writes until the central has subscribed, and any reply gives us ground truth that a
   * command was understood.
   */
  async startNotifications(onEvent: (event: NotificationEvent) => void): Promise<number> {
    if (!this.connectedDevice) {
      throw new Error("No BLE device connected.");
    }

    this.clearNotifications();

    const notifiable = this.gattTable.filter((entry) => entry.notifiable);

    for (const entry of notifiable) {
      try {
        const subscription = this.connectedDevice.monitorCharacteristicForService(
          entry.serviceUuid,
          entry.characteristicUuid,
          (error, characteristic) => {
            if (error || !characteristic?.value) {
              return;
            }

            const bytes = base64ToBytes(characteristic.value);
            onEvent({
              serviceUuid: entry.serviceUuid,
              characteristicUuid: entry.characteristicUuid,
              base64: characteristic.value,
              hex: bytesToHex(bytes),
              text: isPrintable(bytes) ? String.fromCharCode(...bytes).trim() : "",
            });
          },
        );

        this.notificationSubscriptions.push(subscription);
      } catch {
        // Some characteristics advertise notify but reject subscription; skip them.
      }
    }

    return this.notificationSubscriptions.length;
  }

  clearNotifications(): void {
    for (const subscription of this.notificationSubscriptions) {
      try {
        subscription.remove();
      } catch {
        // Already removed.
      }
    }

    this.notificationSubscriptions = [];
  }

  /** Writable targets, best candidates first. */
  getWritableTargets(): BleTarget[] {
    const writable = this.gattTable.filter(
      (entry) => entry.writableWithResponse || entry.writableWithoutResponse,
    );

    if (writable.length === 0) {
      return [this.fallbackTarget];
    }

    const score = (entry: GattEntry): number => {
      const service = entry.serviceUuid.toLowerCase();
      const characteristic = entry.characteristicUuid.toLowerCase();
      let total = 0;

      for (const family of protocolFamilies) {
        const serviceMatch = family.serviceHints.some((hint) => service.includes(hint));
        const characteristicMatch = family.characteristicHints.some((hint) => characteristic.includes(hint));

        if (serviceMatch && characteristicMatch) {
          total += 500;
        } else if (characteristicMatch) {
          total += 150;
        } else if (serviceMatch) {
          total += 60;
        }
      }

      // A proprietary 128-bit service with its own write characteristic is very often
      // the real control channel — vendor apps rarely use the generic 16-bit ones.
      if (!service.startsWith("0000")) {
        total += 450;
      }

      return total;
    };

    return [...writable]
      .sort((a, b) => score(b) - score(a))
      .map((entry) => ({ serviceUuid: entry.serviceUuid, characteristicUuid: entry.characteristicUuid }));
  }

  /**
   * Every (target, protocol family) combination worth testing, best candidates first,
   * so the correct one usually appears within the first few steps.
   */
  buildSweepPlan(): SweepStep[] {
    const targets = this.getWritableTargets();
    const steps: SweepStep[] = [];

    const familyRank = (target: BleTarget, family: ProtocolFamily): number => {
      const service = target.serviceUuid.toLowerCase();
      const characteristic = target.characteristicUuid.toLowerCase();
      const serviceMatch = family.serviceHints.some((hint) => service.includes(hint));
      const characteristicMatch = family.characteristicHints.some((hint) => characteristic.includes(hint));

      if (serviceMatch && characteristicMatch) return 0;
      if (characteristicMatch) return 1;
      if (serviceMatch) return 2;
      return 3;
    };

    // Interleave across targets. Grouping all families per target means a sweep that
    // is stopped early never touches the second characteristic at all — which is
    // exactly how a proprietary control channel gets missed.
    const perTarget = targets.map((target) => ({
      target,
      families: [...protocolFamilies].sort((a, b) => familyRank(target, a) - familyRank(target, b)),
    }));

    for (let depth = 0; depth < protocolFamilies.length; depth += 1) {
      for (const entry of perTarget) {
        const family = entry.families[depth];
        if (!family) {
          continue;
        }

        steps.push({
          index: steps.length,
          target: entry.target,
          familyId: family.id,
          familyLabel: family.label,
        });
      }
    }

    return steps.map((step, index) => ({ ...step, index }));
  }

  /**
   * Runs one identification step: power on, then pulse RED, GREEN, BLUE with pacing.
   * If the strip follows that sequence, this step's target + family is the right one.
   */
  async runSweepStep(step: SweepStep, onLog?: (message: string) => void): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error("No BLE device connected.");
    }

    const family = getProtocolFamily(step.familyId);

    onLog?.(`${family.label} -> ${this.shortUuid(step.target.characteristicUuid)}`);

    await this.writePayloads(family.preamble(), step.target, onLog);
    await this.writePayloads(family.powerOn(), step.target, onLog);

    for (const color of sweepColors) {
      await this.writePayloads(family.color(color.rgb), step.target, onLog);
      await sleep(SWEEP_COLOR_DWELL_MS);
    }
  }

  private shortUuid(uuid: string): string {
    const normalized = uuid.toLowerCase().replace(/-/g, "");
    if (normalized.length === 32 && normalized.startsWith("0000")) {
      return uuid.slice(4, 8).toUpperCase();
    }
    return uuid.toUpperCase();
  }

  /** True once the Zone Sweep has identified how this controller addresses each area. */
  canAddressAreas(): boolean {
    return Boolean(this.lockedProfile?.zoneVariantId);
  }

  /**
   * Candidate ways of addressing an individual area, for the locked protocol family.
   * Empty until a base protocol has been locked in.
   */
  buildZoneSweepPlan(): ZoneSweepStep[] {
    if (!this.lockedProfile) {
      return [];
    }

    return getProtocolFamily(this.lockedProfile.familyId).zoneVariants.map((variant, index) => ({
      index,
      variantId: variant.id,
      variantLabel: variant.label,
    }));
  }

  /**
   * Drives Area 1 red and Area 2 blue using one candidate encoding. If the two strips
   * show different colours, that encoding is the right one.
   */
  async runZoneSweepStep(step: ZoneSweepStep, onLog?: (message: string) => void): Promise<void> {
    if (!this.connectedDevice || !this.lockedProfile) {
      throw new Error("Lock in a base protocol first.");
    }

    const variant = getZoneVariant(this.lockedProfile.familyId, step.variantId);
    if (!variant) {
      throw new Error("Unknown zone encoding.");
    }

    const target = this.lockedTarget();
    onLog?.(`zone test: ${variant.label}`);

    for (const area of [1, 2] as Area[]) {
      await this.writePayloads(variant.color(zoneTestColors[area], area), target, onLog);
      await sleep(250);
    }
  }

  private lockedTarget(): BleTarget {
    if (!this.lockedProfile) {
      return this.fallbackTarget;
    }

    return {
      serviceUuid: this.lockedProfile.serviceUuid,
      characteristicUuid: this.lockedProfile.characteristicUuid,
    };
  }

  /**
   * Sends one area's settings. When no zone encoding has been identified the command
   * is broadcast, which changes both strips together.
   */
  async sendArea(target: ControlTarget, settings: LightSettings): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error("No BLE device connected.");
    }

    // Brightness is sent as its own command, so the colour itself is always at full
    // value. Baking brightness into the RGB *and* sending it separately dims twice.
    const rgb: Rgb = hsvToRgb(settings.hue, settings.saturation, 100);

    if (!this.lockedProfile) {
      await this.sendUnlocked(rgb, settings);
      return;
    }

    const family = getProtocolFamily(this.lockedProfile.familyId);
    const variant = getZoneVariant(this.lockedProfile.familyId, this.lockedProfile.zoneVariantId);
    const bleTarget = this.lockedTarget();

    const areas: Area[] = target === "both" ? [1, 2] : [target === "area1" ? 1 : 2];

    if (!variant) {
      // No zone addressing known yet: broadcast once regardless of the selected area.
      await this.writePayloads(family.color(rgb), bleTarget);
      await this.writePayloads(family.brightness(settings.brightness), bleTarget);
      return;
    }

    for (const area of areas) {
      await this.writePayloads(variant.color(rgb, area), bleTarget);
      await this.writePayloads(variant.brightness(settings.brightness, area), bleTarget);
    }
  }

  /**
   * One frame of a phone-driven effect. Brightness is already folded into `rgb`, so this
   * is a single colour command — keeping the write rate high enough for smooth animation.
   */
  async sendAnimationFrame(target: ControlTarget, rgb: Rgb): Promise<void> {
    if (!this.connectedDevice || !this.lockedProfile) {
      return;
    }

    const family = getProtocolFamily(this.lockedProfile.familyId);
    const variant = getZoneVariant(this.lockedProfile.familyId, this.lockedProfile.zoneVariantId);
    const bleTarget = this.lockedTarget();

    if (!variant || target === "both") {
      await this.writePayloads(family.color(rgb), bleTarget);
      return;
    }

    await this.writePayloads(variant.color(rgb, target === "area1" ? 1 : 2), bleTarget);
  }

  private async sendUnlocked(rgb: Rgb, settings: LightSettings): Promise<void> {
    // No profile locked in yet. Try only the best-matching target/family pairs rather
    // than flooding the device, which is what previously prevented control entirely.
    const targets = this.getWritableTargets().slice(0, 2);
    let lastError: Error | null = null;
    let delivered = false;

    for (const target of targets) {
      const family = this.inferFamily(target);
      try {
        await this.writePayloads(family.color(rgb), target);
        await this.writePayloads(family.brightness(settings.brightness), target);
        delivered = true;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (!delivered) {
      throw lastError ?? new Error("No writable characteristic accepted the command. Run Protocol Sweep.");
    }
  }

  private inferFamily(target: BleTarget): ProtocolFamily {
    const service = target.serviceUuid.toLowerCase();
    const characteristic = target.characteristicUuid.toLowerCase();

    const exact = protocolFamilies.find(
      (family) =>
        family.serviceHints.some((hint) => service.includes(hint)) &&
        family.characteristicHints.some((hint) => characteristic.includes(hint)),
    );

    if (exact) {
      return exact;
    }

    const partial = protocolFamilies.find((family) =>
      family.characteristicHints.some((hint) => characteristic.includes(hint)),
    );

    return partial ?? getProtocolFamily("bledom-7e");
  }

  private async writePayloads(
    payloads: Payload[],
    target: BleTarget,
    onLog?: (message: string) => void,
  ): Promise<void> {
    for (const payload of payloads) {
      await this.writeBytes(payload.bytes, target);
      onLog?.(`  tx ${payload.label}: ${bytesToHex(payload.bytes)}`);
      await sleep(WRITE_GAP_MS);
    }
  }

  /**
   * Serialises every write. The effect animation loop and direct user actions both write
   * to the same characteristic, and interleaving their frames corrupts byte-stream
   * protocols that expect whole frames back to back.
   */
  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(task, task);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async writeBytes(bytes: number[], target: BleTarget): Promise<void> {
    return this.enqueueWrite(() => this.writeBytesUnqueued(bytes, target));
  }

  private async writeBytesUnqueued(bytes: number[], target: BleTarget): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error("No BLE device connected.");
    }

    const value = bytesToBase64(bytes);
    const entry = this.gattTable.find(
      (candidate) =>
        candidate.serviceUuid.toLowerCase() === target.serviceUuid.toLowerCase() &&
        candidate.characteristicUuid.toLowerCase() === target.characteristicUuid.toLowerCase(),
    );

    // Transparent UART bridges are almost always write-without-response; using the
    // advertised property avoids an error round-trip on every single write.
    const preferWithoutResponse = entry ? entry.writableWithoutResponse : true;

    if (preferWithoutResponse) {
      try {
        await this.connectedDevice.writeCharacteristicWithoutResponseForService(
          target.serviceUuid,
          target.characteristicUuid,
          value,
        );
        return;
      } catch (error) {
        if (entry && !entry.writableWithResponse) {
          throw error;
        }
      }
    }

    await this.connectedDevice.writeCharacteristicWithResponseForService(
      target.serviceUuid,
      target.characteristicUuid,
      value,
    );
  }

  /**
   * Sends arbitrary bytes to a chosen characteristic. Used by the manual hex console
   * so captured payloads can be verified without a new build.
   */
  async writeRawBytes(target: BleTarget, bytes: number[]): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error("No BLE device connected.");
    }

    await this.writeBytes(bytes, target);
  }

  async readCurrentState(): Promise<ParsedControllerState | null> {
    if (!this.connectedDevice) {
      throw new Error("No BLE device connected.");
    }

    const readable = this.gattTable.filter((entry) => entry.readable).slice(0, 8);

    for (const entry of readable) {
      try {
        const characteristic = await this.connectedDevice.readCharacteristicForService(
          entry.serviceUuid,
          entry.characteristicUuid,
        );

        const value = characteristic.value?.trim();
        if (!value) {
          continue;
        }

        const parsed = decodeControllerStatePayload(value);
        if (parsed) {
          return parsed;
        }
      } catch {
        // Keep trying other readable characteristics.
      }
    }

    return null;
  }

  destroy(): void {
    this.clearNotifications();
    this.manager?.destroy();
    this.manager = null;
    this.connectedDevice = null;
    this.gattTable = [];
  }
}
