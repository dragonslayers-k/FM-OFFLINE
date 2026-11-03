#!/usr/bin/env bash
set -euo pipefail

# Always use the Debug variant: it exposes a guarded, app-private test import
# hook so this smoke test verifies the same ZIP importer and WebView card loader
# that a user relies on, not merely that an empty activity can launch.
APK="FantasyMastersOffline-debug.apk"
APP_ID="com.fantasy.offline.debug"
PACK_ZIP="release-package/FM1-CardData-v1.3.0.zip"
TEST_PACK_NAME="fm1-emulator-smoke.zip"

test -s "$APK" || { echo "::error::No Debug APK found for emulator smoke test"; exit 1; }
test -s "$PACK_ZIP" || { echo "::error::The generated FM1 card ZIP is missing"; exit 1; }
adb wait-for-device
# The Android emulator is a userdebug image. Root lets the failure handler
# preserve native tombstones, which are the missing evidence for SIGTRAP.
adb root >/dev/null 2>&1 || true
adb wait-for-device
adb logcat -G 16M >/dev/null 2>&1 || true
adb logcat -c
adb install -r "$APK"

capture_failure_logs() {
  adb logcat -b all -d -v threadtime > emulator-launch-logcat-full.txt || true
  adb shell dumpsys activity exit-info "$APP_ID" > emulator-process-exit-info.txt 2>&1 || true
  adb shell dumpsys meminfo "$APP_ID" > emulator-app-meminfo.txt 2>&1 || true
  adb shell dumpsys meminfo > emulator-system-meminfo.txt 2>&1 || true
  adb shell 'ls -t /data/tombstones/tombstone_* 2>/dev/null | head -n 8' > emulator-tombstone-list.txt || true
  while IFS= read -r tombstone; do
    [ -n "$tombstone" ] || continue
    name="$(basename "$tombstone")"
    adb shell "cat '$tombstone'" > "emulator-$name.txt" 2>&1 || true
  done < emulator-tombstone-list.txt
  {
    grep -E "FATAL EXCEPTION|Fatal signal|am_crash|AndroidRuntime|Process .* has died|Killing .*fantasy.offline|OutOfMemory|lowmemorykiller|FM1CardData|chromium|crash_dump|tombstone" emulator-launch-logcat-full.txt || true
    cat emulator-process-exit-info.txt || true
    cat emulator-app-meminfo.txt || true
  } > emulator-launch-log.txt
  cat emulator-launch-log.txt || true
}

# Stream the 400MB-class test ZIP directly into this Debug app's private files;
# no storage permission or exported production import endpoint is introduced.
adb shell "run-as '$APP_ID' sh -c 'mkdir -p files && cat > files/$TEST_PACK_NAME'" < "$PACK_ZIP"
adb shell "run-as '$APP_ID' test -s 'files/$TEST_PACK_NAME'"

COMPONENT="$APP_ID/com.fantasy.offline.MainActivity"
# Do not use "am start -W": cold Android 14 emulator boots can exceed adb's
# wait-for-fully-drawn timeout even while ActivityManager starts the app.
START_OUTPUT="$(adb shell am start -n "$COMPONENT" --es fm1.testDataPackFile "$TEST_PACK_NAME" 2>&1 || true)"
printf '%s\n' "$START_OUTPUT"
if grep -Eq 'Error type [0-9]+|Error: Activity class|Exception occurred' <<<"$START_OUTPUT"; then
  echo "::error::Android activity could not be started"
  capture_failure_logs
  exit 1
fi

# Require the real importer to verify the ZIP, all 15,350 card records and
# images, then require the WebView to parse and normalize every card via pages.
CARD_LOAD_OK=false
APP_SEEN=false
for attempt in $(seq 1 720); do
  DATA_LOG="$(adb logcat -d -s FM1CardData:V 2>/dev/null || true)"
  if grep -q 'WEBVIEW_CARDS_LOADED=15350/15350' <<<"$DATA_LOG"; then
    CARD_LOAD_OK=true
    break
  fi
  if grep -q 'WEBVIEW_CARDS_FAILED=' <<<"$DATA_LOG"; then
    echo "::error::The app installed the pack but failed to load every card in WebView"
    capture_failure_logs
    exit 1
  fi
  APP_PID="$(adb shell pidof "$APP_ID" 2>/dev/null | tr -d '\r\n' || true)"
  if [ -n "$APP_PID" ]; then
    APP_SEEN=true
  elif [ "$attempt" -gt 45 ] && [ "$APP_SEEN" = true ]; then
    echo "::error::Application process exited during card ZIP import or WebView loading"
    capture_failure_logs
    exit 1
  fi
  sleep 1
done

if [ "$CARD_LOAD_OK" != true ]; then
  echo "::error::Timed out after 12 minutes waiting for WebView confirmation of all 15,350 cards"
  capture_failure_logs
  exit 1
fi

APP_PID="$(adb shell pidof "$APP_ID" 2>/dev/null | tr -d '\r\n' || true)"
test -n "$APP_PID" || { echo "::error::Application process exited after card loading"; exit 1; }
adb exec-out screencap -p > emulator-screen.png
test -s emulator-screen.png
adb logcat -d -s AndroidRuntime:E ActivityManager:E FM1CardData:V > emulator-launch-log.txt || true
echo "Emulator card-data import + WebView load smoke test: PASS ($APP_ID, cards=15350, pid=$APP_PID)"
