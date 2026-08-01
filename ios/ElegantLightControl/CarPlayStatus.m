#import <AVFoundation/AVFoundation.h>
#import <React/RCTBridgeModule.h>

// Is the phone currently plugged into the car?
//
// There is no public API that simply asks. The reliable proxy is the audio route: when
// CarPlay is active the session's current route contains a port of type
// AVAudioSessionPortCarAudio. That is what the system itself uses to decide where sound goes,
// so it is true exactly when CarPlay is up.
//
// Polled rather than pushed. Route-change notifications would need an event emitter, and the
// app only cares at two moments — launch and returning to the foreground — both of which are
// already places where JS runs. A Shortcuts automation on "CarPlay connects" is what brings
// the app forward in the first place.
@interface CarPlayStatus : NSObject <RCTBridgeModule>
@end

@implementation CarPlayStatus

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(isActive : (RCTPromiseResolveBlock)resolve rejecter : (RCTPromiseRejectBlock)reject)
{
  AVAudioSessionRouteDescription *route = [AVAudioSession sharedInstance].currentRoute;

  for (AVAudioSessionPortDescription *output in route.outputs) {
    if ([output.portType isEqualToString:AVAudioSessionPortCarAudio]) {
      resolve(@YES);
      return;
    }
  }

  resolve(@NO);
}

@end
