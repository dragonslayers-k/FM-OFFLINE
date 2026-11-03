#!/usr/bin/env bash
set -euo pipefail

APK="$(if [ -s FantasyMastersOffline-release.apk ]; then printf '%s' FantasyMastersOffline-release.apk; else printf '%s' FantasyMastersOffline-debug.apk; fi)"
APP_ID="$(if [ "$APK" = FantasyMastersOffline-release.apk ]; then printf '%s' com.fantasy.offline; else printf '%s' com.fantasy.offline.debug; fi)"

test -s "$APK" || { echo "::error::No APK artifact found for emulator smoke test"; exit 1; }
adb wait-for-device
adb logcat -c
adb install -r "$APK"
adb shell am force-stop "$APP_ID"
COMPONENT="$APP_ID/com.fantasy.offline.MainActivity"
START_OUTPUT="$(adb shell am start -W -n "$COMPONENT" 2>&1 || true)"
printf '%s\\n' "$START_OUTPUT"
grep -Eq 'Status: ok|LaunchState: (HOT|WARM|COLD)' <<<"$START_OUTPUT" || { echo "::error::Android activity did not report a successful launch"; adb logcat -d -s AndroidRuntime:E ActivityManager:E > emulator-launch-log.txt || true; cat emulator-launch-log.txt || true; exit 1; }
sleep 5
APP_PID="$(adb shell pidof "$APP_ID" 2>/dev/null | tr -d '\\r\\n' || true)"
test -n "$APP_PID" || { echo "::error::Application process exited after launch"; adb logcat -d -s AndroidRuntime:E ActivityManager:E > emulator-launch-log.txt || true; cat emulator-launch-log.txt || true; exit 1; }
adb exec-out screencap -p > emulator-screen.png
test -s emulator-screen.png
adb logcat -d -s AndroidRuntime:E ActivityManager:E > emulator-launch-log.txt || true
echo "Emulator install/launch smoke test: PASS ($APP_ID, pid=$APP_PID)"
