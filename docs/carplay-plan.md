# Apple CarPlay Plan

## Goal
Enable control of ambient lights from Apple CarPlay while keeping BLE communication on iPhone.

## Constraints
- Full CarPlay apps require Apple CarPlay entitlement approval and must fit supported CarPlay app categories.
- Current Expo managed workflow is not enough for full CarPlay UI; native iOS integration is required.
- BLE control reliability on iOS lock/background requires background BLE configuration and testing.

## Phase 1: Fast Path (No CarPlay Entitlement)
1. Add App Intents / Siri Shortcuts for common actions:
   - Area 1 color presets
   - Area 2 color presets
   - Both areas color presets
   - Mode presets (Monochrome, Breathe, Strobe, Gradient)
2. Expose these actions to Shortcuts so user can run from CarPlay Shortcuts view.
3. Add in-app diagnostics for intent execution + BLE send result.

## Phase 2: Native iOS Readiness
1. Move to prebuild/ejected workflow for iOS native features.
2. Add/verify iOS background capabilities:
   - bluetooth-central
3. Implement robust command queue for BLE writes from app intent triggers.
4. Add telemetry for:
   - selected target
   - payload family used
   - write result per characteristic

## Phase 3: Full CarPlay (If Approved)
1. Apply for CarPlay entitlement with Apple.
2. Implement template-based CarPlay UI for safe controls:
   - Quick presets
   - Target selector (Area 1 / Area 2 / Both)
   - Mode selector
3. Connect CarPlay UI actions to existing BLE command pipeline.

## Testing Plan
1. Xcode CarPlay Simulator tests for action flow.
2. Real vehicle tests:
   - ignition transitions
   - reconnect behavior
   - command latency
3. Safety checks:
   - large touch targets
   - minimal driver distraction flow

## Current Recommendation
Start with Phase 1 (Shortcuts/App Intents) immediately; it gives practical CarPlay access while full entitlement path is evaluated.
