#!/bin/bash

# MUNEEM - Raspberry Pi 5 Kiosk Mode Launcher
# Optimized for 10.1" touchscreen display
# Starts all services and launches Chromium in fullscreen kiosk mode

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."
APP_DIR=$(pwd)

echo "🚀 Starting MUNEEM in Pi 5 Kiosk Mode..."

# Wait for desktop to fully load (important on boot)
sleep 3

# Disable screen blanking / power saving
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true

# Hide mouse cursor after 1 second of inactivity
unclutter -idle 1 -root &

# Start backend services
echo "🔧 Starting backend services..."
bash "$APP_DIR/start.sh" > /tmp/muneem-kiosk.log 2>&1

# Wait for services to be ready (Pi 5 is fast, 5s is enough)
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

# Find Chromium binary (varies between Pi OS versions)
CHROMIUM_CMD=""
for cmd in chromium chromium-browser google-chrome; do
    if command -v $cmd &>/dev/null; then
        CHROMIUM_CMD=$cmd
        break
    fi
done

if [ -z "$CHROMIUM_CMD" ]; then
    echo "❌ Chromium not found. Install with: sudo apt install chromium-browser"
    exit 1
fi

echo "🌐 Launching Chromium in kiosk mode (10.1\" 1280x800)..."

# Launch Chromium in kiosk mode
# --window-size optimized for 10.1" display at 1280x800
$CHROMIUM_CMD \
    --kiosk \
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
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-breakpad \
    --disable-client-side-phishing-detection \
    --disable-component-update \
    --disable-default-apps \
    --disable-dev-shm-usage \
    --disable-extensions \
    --disable-hang-monitor \
    --disable-notifications \
    --disable-popup-blocking \
    --disable-print-preview \
    --disable-prompt-on-repost \
    --disable-sync \
    --disable-translate \
    --metrics-recording-only \
    --no-first-run \
    --no-default-browser-check \
    --password-store=basic \
    --use-mock-keychain \
    --touch-events=enabled \
    --enable-touch-drag-drop \
    http://localhost:5173

echo "✅ Kiosk session ended."
