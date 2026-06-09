# Fast deploy — no Gradle build. Use when Android Studio times out after 5 minutes.
$ErrorActionPreference = "Stop"
$apk = "D:\shoRDs\shoRDs-android-studio-emulator.apk"
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

if (-not (Test-Path $apk)) {
    Write-Host "APK missing. Run: powershell -File sync-studio-with-phone.ps1"
    exit 1
}

& $adb wait-for-device
& $adb install -r $apk
& $adb shell am start -n com.anonymous.shords/.MainActivity
Write-Host "Launched shoRDs (same build as phone APK)."
