import { BleManager, type Device, State } from "react-native-ble-plx";
import { Platform, PermissionsAndroid } from "react-native";

import type { ProtocolProfile, ZoneKey, ZoneSettings } from "../types";
import { encodeZoneSettings } from "./ambientControllerProtocol";

export class BleAmbientController {
  private readonly manager = new BleManager();

  private connectedDevice: Device | null = null;

  private serviceUuid = "0000FFE0-0000-1000-8000-00805F9B34FB";

  private characteristicUuid = "0000FFE1-0000-1000-8000-00805F9B34FB";

  private protocolProfile: ProtocolProfile = "json-v1";

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== "android") {
      return true;
    }

    if (Platform.Version >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);

      return Object.values(result).every(
        (permission) => permission === PermissionsAndroid.RESULTS.GRANTED,
      );
    }

    const fineLocation = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );

    return fineLocation === PermissionsAndroid.RESULTS.GRANTED;
  }

  async ensureReady(): Promise<void> {
    const state = await this.manager.state();
    if (state === State.PoweredOn) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const subscription = this.manager.onStateChange((nextState) => {
        if (nextState === State.PoweredOn) {
          subscription.remove();
          resolve();
        }
      }, true);

      setTimeout(() => {
        subscription.remove();
        reject(new Error("Bluetooth is off. Please enable Bluetooth and try again."));
      }, 12000);
    });
  }

  setTarget(serviceUuid: string, characteristicUuid: string): void {
    this.serviceUuid = serviceUuid.trim();
    this.characteristicUuid = characteristicUuid.trim();
  }

  setProtocolProfile(profile: ProtocolProfile): void {
    this.protocolProfile = profile;
  }

  startScan(onDevice: (device: Device) => void): void {
    this.manager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error || !scannedDevice) {
        return;
      }

      onDevice(scannedDevice);
    });
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
  }

  async connect(deviceId: string): Promise<Device> {
    const connected = await this.manager.connectToDevice(deviceId, { timeout: 12000 });
    await connected.discoverAllServicesAndCharacteristics();
    this.connectedDevice = connected;
    return connected;
  }

  async disconnect(): Promise<void> {
    if (!this.connectedDevice) {
      return;
    }

    await this.manager.cancelDeviceConnection(this.connectedDevice.id);
    this.connectedDevice = null;
  }

  getConnectedDevice(): Device | null {
    return this.connectedDevice;
  }

  async sendZone(zone: ZoneKey, settings: ZoneSettings): Promise<void> {
    if (!this.connectedDevice) {
      throw new Error("No BLE device connected.");
    }

    const payload = encodeZoneSettings(zone, settings, this.protocolProfile);
    await this.connectedDevice.writeCharacteristicWithResponseForService(
      this.serviceUuid,
      this.characteristicUuid,
      payload,
    );
  }

  destroy(): void {
    this.manager.destroy();
  }
}
