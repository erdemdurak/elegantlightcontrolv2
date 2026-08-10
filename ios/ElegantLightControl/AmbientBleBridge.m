#import <React/RCTBridgeModule.h>

// Bridge for AmbientBle.swift. No promises or callbacks: every method is fire-and-forget,
// matching BackgroundKeepAlive.m's reasoning — a write that fails is logged natively, and
// making JS await a BLE write it does not own would only invite it to serialise against a
// queue that already serialises itself.
@interface RCT_EXTERN_MODULE (AmbientBle, NSObject)

// Which controller to reconnect to. JS holds this in AsyncStorage; CoreBluetooth needs it in
// UserDefaults because the native side must work with no JS runtime alive.
RCT_EXTERN_METHOD(publishDeviceId : (NSString *)deviceId)

// True while JS owns the radio. Two centrals writing interleaved frames would corrupt state,
// because every Lenze frame carries both areas.
RCT_EXTERN_METHOD(setSuppressed : (BOOL)suppressed)

// Seed the remembered colours and brightness so a single-area change does not reset the other.
RCT_EXTERN_METHOD(seedState
                  : (NSString *)area1Hex area2Hex
                  : (NSString *)area2Hex brightness1
                  : (NSInteger)brightness1 brightness2
                  : (NSInteger)brightness2)

@end
