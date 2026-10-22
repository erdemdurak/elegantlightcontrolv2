# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# R8 is on so Play sees a shrunk, obfuscated build — it flags anything under 25%, and with
# shrinking off only the pre-obfuscated libraries counted, which came to 2%.
#
# Everything below is a library that finds its own code by name at runtime, where renaming
# silently breaks the lookup rather than failing to compile.

# react-native-ble-plx talks to the JNI layer and resolves RxJava internals reflectively.
-keep class com.bleplx.** { *; }
-keep class com.polidea.** { *; }
-dontwarn rx.**
-dontwarn io.reactivex.**

# react-native-iap on Nitro: the codegen'd HybridObject classes are looked up by name from C++.
-keep class com.margelo.nitro.** { *; }
-keep class dev.hyo.** { *; }
-keep class com.android.billingclient.** { *; }

# react-native-svg resolves view managers and prop setters by name.
-keep class com.horcrux.svg.** { *; }

# Our own package, so the RN bridge can still find the module and package classes.
-keep class com.elegantlightcontrol.** { *; }
