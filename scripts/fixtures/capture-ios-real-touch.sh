#!/usr/bin/env bash
# Capture a real iOS Simulator background frame, then composite a
# calibrated "Show Single Touches" overlay disk to produce
# tests/fixtures/recorder/video-frames/ios-real-touch.png.
#
# We can't drive a real touch from headless CLI (Accessibility API access is
# required for osascript-based clicking), so the disk is synthesized — but
# the *background* is a real iOS Simulator screenshot, so the calibration
# verifies the colour band against authentic iOS UI pixels rather than a
# pure black canvas.
#
# Prereqs: Xcode + a booted iOS Simulator. Run:
#   xcrun simctl boot <udid>
#   open -a Simulator
#
# This script reads the booted simulator, extracts a 200x100 crop, and pipes
# to scripts/fixtures/composite-ios-touch-overlay.js to add the disk.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BG="$(mktemp -t ios-bg).png"

xcrun simctl io booted screenshot "$BG"

node "$ROOT/scripts/fixtures/composite-ios-touch-overlay.js" \
  "$BG" \
  "$ROOT/tests/fixtures/recorder/video-frames/ios-real-touch.png"

rm -f "$BG"

echo "wrote tests/fixtures/recorder/video-frames/ios-real-touch.png"
