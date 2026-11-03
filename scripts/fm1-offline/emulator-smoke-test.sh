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
adb logcat -c
adb install -r "$APK"

# Stream the 400MB-class test ZIP directly into this Debug app's private files;
# no storage permission or exported production import endpoint is introduced.
adb shell run-as "$APP_ID" sh -c "cat > files/$TEST_PACK_NAME" < "$PACK_ZIP"
adb shell run-as "$APP_ID" test -s "files/$TEST_PACK_NAME"

COMPONENT="$APP_ID/com.fantasy.offline.MainActivity"
START_OUTPUT="$(adb shell am start -W -n "$COMPONENT" --es fm1.testDataPackFile "$TEST_PACK_NAME" 2>&1 || true)"
printf '%s\n' "$START_OUTPUT"
grep -Eq 'Status: ok|LaunchState: (HOT|WARM|COLD)' <<<"$START_OUTPUT" || {
  echo "::error::Android activity did not report a successful launch"
  adb logcat -d -s AndroidRuntime:E ActivityManager:E FM1CardData:E > emulator-launch-log.txt || true
  cat emulator-launch-log.txt || true
  exit 1
}

# Require the real importer to verify the ZIP, all 15,350 card records and
# images, then require the WebView to parse and normalize every card via pages.
CARD_LOAD_OK=false
for attempt in $(seq 1 360); do
  DATA_LOG="$(adb logcat -d -s FM1CardData:I FM1CardData:E 2>/dev/null || true)"
  if grep -q 'WEBVIEW_CARDS_LOADED=15350/15350' <<<"$DATA_LOG"; then
    CARD_LOAD_OK=true
    break
  fi
  if grep -q 'WEBVIEW_CARDS_FAILED=' <<<"$DATA_LOG"; then
    echo "::error::The app installed the pack but failed to load every card in WebView"
    adb logcat -d -s AndroidRuntime:E ActivityManager:E FM1CardData:E > emulator-launch-log.txt || true
    cat emulator-launch-log.txt || true
    exit 1
  fi
  APP_PID="$(adb shell pidof "$APP_ID" 2>/dev/null | tr -d '\r\n' || true)"
  if [ -z "$APP_PID" ]; then
    echo "::error::Application process exited during card ZIP import or WebView loading"
    adb logcat -d -s AndroidRuntime:E ActivityManager:E FM1CardData:E > emulator-launch-log.txt || true
    cat emulator-launch-log.txt || true
    exit 1
  fi
  sleep 1
done

if [ "$CARD_LOAD_OK" != true ]; then
  echo "::error::Timed out waiting for WebView confirmation of all 15,350 cards"
  adb logcat -d -s AndroidRuntime:E ActivityManager:E FM1CardData:E > emulator-launch-log.txt || true
  cat emulator-launch-log.txt || true
  exit 1
fi

APP_PID="$(adb shell pidof "$APP_ID" 2>/dev/null | tr -d '\r\n' || true)"
test -n "$APP_PID" || { echo "::error::Application process exited after card loading"; exit 1; }
adb exec-out screencap -p > emulator-screen.png
test -s emulator-screen.png
adb logcat -d -s AndroidRuntime:E ActivityManager:E FM1CardData:I FM1CardData:E > emulator-launch-log.txt || true
echo "Emulator card-data import + WebView load smoke test: PASS ($APP_ID, cards=15350, pid=$APP_PID)"
