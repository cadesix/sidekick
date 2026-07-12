#!/bin/bash
# Self-debug loop for the GL scene on the iOS simulator.
#
# Capture channel: macOS `screencapture -l <windowID>` of the Simulator's
# device window — works across Spaces WITHOUT stealing focus, and (unlike
# every other channel) actually composites the expo-gl layer:
#   - simctl screenshot: misses the GL layer (blank)
#   - simctl recordVideo: degrades to 1-frame clips after repeated use
#   - GLView.takeSnapshotAsync / gl.readPixels / readRenderTargetPixels:
#     all hard-hang expo-gl on the New Architecture
# The window ID comes from scripts/bin/simwin (Swift, CGWindowList across
# all Spaces; picks the tall phone-shaped Simulator window).
#
# Flow: cold-relaunch the app (Fast Refresh does NOT re-run the GL context),
# wait for bundle + GLB load, capture → /tmp/sk-debug.png, tail Metro log.
#
# Usage: scripts/sim-snap.sh [wait_seconds] [metro_log]
set -euo pipefail

APP=com.cadesix.sidekick-mobile
WAIT="${1:-12}"
METRO_LOG="${2:-/tmp/sk-metro.log}"
DIR="$(cd "$(dirname "$0")" && pwd)"

xcrun simctl terminate booted "$APP" >/dev/null 2>&1 || true
sleep 1
xcrun simctl launch booted "$APP" >/dev/null
sleep "$WAIT"

WID=$("$DIR/bin/simwin")
if [[ -z "$WID" ]]; then
  echo "NO SIMULATOR WINDOW FOUND (is the Simulator app running?)"
  exit 1
fi
screencapture -x -o -l "$WID" /tmp/sk-debug.png
echo "frame: /tmp/sk-debug.png (window $WID)"

if [[ -f "$METRO_LOG" ]]; then
  echo "--- metro (since last bundle) ---"
  awk '/Bundled/{l=NR}{a[NR]=$0}END{for(i=l;i<=NR;i++)print a[i]}' "$METRO_LOG" \
    | grep -E "\[sidekick\]|Shader Error|ERROR" | tail -8 || true
fi
