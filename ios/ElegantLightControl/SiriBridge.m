#import <React/RCTBridgeModule.h>

// Hands the App Intents' pending command to JS. Pure Objective-C on purpose: RCTPromise
// blocks are visible here without a bridging header, which keeps AmbientIntents.swift free
// of any React types.
//
// Read-and-clear in one call, so a command cannot be applied twice if the app is foregrounded
// again before the next intent runs.
@interface SiriBridge : NSObject <RCTBridgeModule>
@end

@implementation SiriBridge

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(consumePendingCommand
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  NSString *pending = [defaults stringForKey:@"pendingSiriCommand"];

  if (pending != nil) {
    [defaults removeObjectForKey:@"pendingSiriCommand"];
  }

  resolve(pending ?: [NSNull null]);
}

@end
