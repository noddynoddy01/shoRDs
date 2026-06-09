# Builds the same embedded-bundle release used on phone, for emulator + phone APKs.
$ErrorActionPreference = "Stop"
$env:GRADLE_USER_HOME = "D:\g"
$env:NODE_ENV = "production"
$root = Split-Path $PSScriptRoot -Parent

Set-Location $PSScriptRoot
& "$PSScriptRoot\clean-caches.ps1"

Remove-Item -Recurse -Force "$PSScriptRoot\app\build\generated" -ErrorAction SilentlyContinue

Write-Host "Building phone release (ARM)..."
& .\gradlew assembleRelease "-PreactNativeArchitectures=arm64-v8a,armeabi-v7a"
Copy-Item "$PSScriptRoot\app\build\outputs\apk\release\app-release.apk" "$root\shoRDs-release-phone.apk" -Force

Write-Host "Building emulator release (x86_64) — same UI as phone APK..."
& .\gradlew assembleRelease "-PreactNativeArchitectures=x86_64"
Copy-Item "$PSScriptRoot\app\build\outputs\apk\release\app-release.apk" "$root\shoRDs-android-studio-emulator.apk" -Force

Write-Host "Building debug with embedded bundle (Android Studio Run)..."
& .\gradlew assembleDebug
Copy-Item "$PSScriptRoot\app\build\outputs\apk\debug\app-debug.apk" "$root\shoRDs-android-studio-debug.apk" -Force

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adb) {
    $devices = & $adb devices | Select-String "device$"
    if ($devices) {
        Write-Host "Installing emulator release APK on device..."
        & $adb install -r "$root\shoRDs-android-studio-emulator.apk"
    }
}

Write-Host "Done. Phone + emulator APKs now share the same JS bundle."
