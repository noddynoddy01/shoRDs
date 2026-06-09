# Run before Android Studio build if CMake/OneDrive path errors return.
$ErrorActionPreference = "SilentlyContinue"
$env:GRADLE_USER_HOME = "D:\g"

Write-Host "Stopping Gradle daemons..."
& "$PSScriptRoot\gradlew.bat" --stop

$paths = @(
    "$PSScriptRoot\app\.cxx",
    "$PSScriptRoot\build",
    "$PSScriptRoot\..\node_modules\react-native-worklets\android\.cxx",
    "$PSScriptRoot\..\node_modules\react-native-reanimated\android\.cxx",
    "$PSScriptRoot\..\node_modules\react-native-screens\android\.cxx",
    "$PSScriptRoot\..\node_modules\expo-modules-core\android\.cxx",
    "$PSScriptRoot\..\node_modules\react-native-gesture-handler\android\.cxx"
)

foreach ($path in $paths) {
    if (Test-Path $path) {
        Write-Host "Removing $path"
        Remove-Item -Recurse -Force $path
    }
}

Get-ChildItem "$PSScriptRoot\..\node_modules" -Recurse -Directory -Filter ".cxx" | Remove-Item -Recurse -Force

$oneDriveGradle = "$env:USERPROFILE\OneDrive\Documents\selectgradleuser android directory"
if (Test-Path $oneDriveGradle) {
    Write-Host "Removing stale OneDrive Gradle cache: $oneDriveGradle"
    Remove-Item -Recurse -Force $oneDriveGradle
}

Write-Host "Done. Gradle home is D:\g only."
