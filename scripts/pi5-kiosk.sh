#!/bin/bash

# MUNEEM - Raspberry Pi 5 Kiosk Mode Launcher
# Optimized for 10.1" touchscreen display (Bookworm / Wayland compatible)

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."
APP_DIR=$(pwd)

echo "🚀 Starting MUNEEM in Pi 5 Kiosk Mode..."

# Wait for desktop to fully load
sleep 3

# ── Kill any existing Chromium (REQUIRED for --kiosk to work) ─────────────
echo "🧹 Killing existing Chromium instances..."
pkill -f chromium 2>/dev/null || true
sleep 2

# ── Screen blanking (detect Wayland vs X11) ───────────────────────────────
if [ -n "$DISPLAY" ]; then
    echo "🖥️  X11 detected — disabling screen blanking..."
    xset s off 2>/dev/null || true
    xset -dpms 2>/dev/null || true
    xset s noblank 2>/dev/null || true
    command -v unclutter &>/dev/null && unclutter -idle 1 -root &
elif [ -n "$WAYLAND_DISPLAY" ]; then
    echo "🖥️  Wayland detected — disabling idle..."
    gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null || true
fi

# ── Start backend services ────────────────────────────────────────────────
echo "🔧 Starting backend services..."
bash "$APP_DIR/start.sh" > /tmp/muneem-kiosk.log 2>&1

# Wait for backend
echo "⏳ Waiting for services..."
MAX_WAIT=30
WAITED=0
until curl -s http://localhost:8000/api/v1/health > /dev/null 2>&1; do
    sleep 1
    WAITED=$((WAITED+1))
    if [ $WAITED -ge $MAX_WAIT ]; then
        echo "⚠️  Backend timeout, launching browser anyway..."
        break
    fi
done

# ── Find Chromium binary ───────────────────────────────────────────────────
CHROMIUM_CMD=""
for cmd in chromium chromium-browser google-chrome; do
    if command -v $cmd &>/dev/null; then
        CHROMIUM_CMD=$cmd
        break
    fi
done

if [ -z "$CHROMIUM_CMD" ]; then
    echo "❌ Chromium not found. Install: sudo apt install chromium"
    exit 1
fi

# ── Wayland vs X11 flag ───────────────────────────────────────────────────
OZONE_FLAG=""
if [ -n "$WAYLAND_DISPLAY" ] && [ -z "$DISPLAY" ]; then
    OZONE_FLAG="--ozone-platform=wayland"
    echo "🖥️  Using Wayland mode"
fi

# ── Use a fresh profile dir so --kiosk always opens a new instance ────────
PROFILE_DIR="/tmp/muneem-kiosk-profile"
rm -rf "$PROFILE_DIR"
mkdir -p "$PROFILE_DIR"

echo "🌐 Launching Chromium kiosk (1280x800, touch enabled)..."

$CHROMIUM_CMD \
    --kiosk \
    --user-data-dir="$PROFILE_DIR" \
    $OZONE_FLAG \
    --no-sandbox \
    --window-size=1280,800 \
    --start-fullscreen \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-restore-session-state \
    --disable-features=TranslateUI \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --autoplay-policy=no-user-gesture-required \
    --check-for-update-interval=31536000 \
    --disable-background-networking \
    --disable-component-update \
    --disable-default-apps \
    --disable-dev-shm-usage \
    --disable-extensions \
    --disable-hang-monitor \
    --disable-notifications \
    --disable-popup-blocking \
    --disable-print-preview \
    --disable-sync \
    --disable-translate \
    --no-first-run \
    --no-default-browser-check \
    --password-store=basic \
    --use-mock-keychain \
    --touch-events=enabled \
    --enable-touch-drag-drop \
    http://localhost:5173

echo "✅ Kiosk session ended."
