#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Wakes JS the moment a CarPlay row is tapped.
//
// The row also parks its command in UserDefaults, which JS drains on launch and on every
// foreground — that alone would work, but only once the app came forward, and CarPlay can
// leave the app in the background indefinitely. This turns the same command into a live event
// so the lights change while the driver's finger is still on the screen.
//
// Pure Objective-C so the Swift side needs no bridging header; it only posts a notification.
@interface CarPlayBridge : RCTEventEmitter <RCTBridgeModule>
@end

@implementation CarPlayBridge

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"carPlayCommand" ];
}

- (void)startObserving
{
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleCommand:)
                                               name:@"ElegantLightCarPlayCommand"
                                             object:nil];
}

- (void)stopObserving
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

// The presets and their colours live in src/themes.ts and change often — they have already
// been revised several times. Rather than keep a Swift copy that silently goes stale, JS
// publishes them here and CarPlay draws whatever it finds.
RCT_EXPORT_METHOD(publishPresets : (NSString *)json)
{
  [[NSUserDefaults standardUserDefaults] setObject:json forKey:@"carPlayPresets"];
}

- (void)handleCommand:(NSNotification *)note
{
  // The payload is sent along, but JS reads UserDefaults anyway — that path is shared with
  // Siri and clears the command atomically, so a tap cannot be applied twice.
  [self sendEventWithName:@"carPlayCommand" body:note.userInfo ?: @{}];
}

@end
