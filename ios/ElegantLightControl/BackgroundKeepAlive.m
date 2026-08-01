#import <React/RCTBridgeModule.h>

// Bridge for BackgroundKeepAlive.swift. Kept deliberately free of promises and callbacks:
// with no React types in the signatures the Swift side needs no bridging header, which is
// one less build setting to keep in sync.
@interface RCT_EXTERN_MODULE (BackgroundKeepAlive, NSObject)

RCT_EXTERN_METHOD(start)
RCT_EXTERN_METHOD(stop)

@end
