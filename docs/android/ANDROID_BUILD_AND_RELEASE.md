# shoRDs Android Native Build & Release Guide

## 1. Overview
The mobile version of **shoRDs** is built as an Android application using **React Native 0.79+** and **Expo SDK 52 / Prebuild** with custom native Kotlin modules.

---

## 2. Directory Structure (`android/`)
```
android/
├── app/
│   ├── build.gradle                # Android application build configuration
│   ├── debug.keystore              # Development signing certificate
│   ├── proguard-rules.pro          # Code shrinking & obfuscation rules
│   └── src/
│       ├── debug/AndroidManifest.xml
│       └── main/
│           ├── AndroidManifest.xml # Core app permissions & intents
│           ├── java/com/anonymous/shords/
│           │   ├── MainActivity.kt # React Native host activity
│           │   └── MainApplication.kt # Expo & React application delegate
│           └── res/                # App icons, splash screens, mipmaps, colors
├── build.gradle                    # Project-level Gradle build script
├── gradle.properties               # JVM memory, AndroidX, and build flags
├── gradlew & gradlew.bat           # Gradle wrapper execution binaries
└── settings.gradle                 # Subproject and plugin inclusion
```

---

## 3. Build & Execution Instructions

### A. Prerequisites
- **JDK**: Java Development Kit 17 or 21 (LTS).
- **Android SDK**: API Level 34 (Android 14) / Platform Tools.
- **Node.js**: Node v20 LTS.

### B. Dry-Run & Task Verification
To verify the Android build scripts and dependencies without compiling binaries:
```bash
cd android
./gradlew tasks --dry-run # On Windows: .\gradlew tasks --dry-run
```

### C. Building the Debug APK
```bash
cd android
./gradlew assembleDebug
# Generated output: android/app/build/outputs/apk/debug/app-debug.apk
```

### D. Building the Release APK
```bash
cd android
./gradlew assembleRelease
# Generated output: android/app/build/outputs/apk/release/app-release.apk
```

---

## 4. Release Distribution Policy
Binary files (`*.apk`, `*.aab`) are excluded from the main Git repository via `.gitignore` to keep repository size lean and reproducible. Production APK binaries are distributed via **GitHub Releases** and the shoRDs official web platform.
