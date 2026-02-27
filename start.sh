#!/bin/bash

# MUNEEM Application Startup Script
# Starts all services with a single command

set -e

echo "🚀 Starting MUNEEM Application..."
echo ""

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Stop any existing services
echo "🛑 Cleaning up existing services..."
lsof -ti:5173,8000,9000 2>/dev/null | xargs kill -9 2>/dev/null || true
ps aux | grep -E "(vite|uvicorn|npm.*dev|python.*main)" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
sleep 1

# Start Backend API
echo "🔧 Starting Backend API (port 8000)..."
cd backend
if [ ! -d "venv" ]; then
    echo "⚠️  Backend venv not found. Creating..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -q -r requirements.txt
else
    source venv/bin/activate
fi
# Start with memory-aware worker count (1 worker for Pi 4, 2 for Pi 5)
# Use single worker for Pi 4 to conserve memory
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
cd "$SCRIPT_DIR"

# Start TesseractOCR Service (in parallel)
echo "📸 Starting TesseractOCR service (port 9000)..."
cd backend/services/tesseract_ocr
if [ ! -d "venv" ]; then
    echo "⚠️  OCR Service venv not found. Creating..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -q -r requirements.txt
else
    source venv/bin/activate
fi
uvicorn ocr_service:app --host 0.0.0.0 --port 9000 > /tmp/ocr_service.log 2>&1 &
OCR_PID=$!
cd "$SCRIPT_DIR"

# Start Frontend (in parallel)
echo "⚛️  Starting Frontend (port 5173)..."
if [[ "$1" == "--prod" ]]; then
    echo "   Using Production Build (dist/)..."
    python3 -m http.server 5173 --directory dist > /tmp/frontend.log 2>&1 &
else
    echo "   Using Development Server..."
    npm run dev > /tmp/frontend.log 2>&1 &
fi
FRONTEND_PID=$!

# Wait for all services to start (parallel wait)
sleep 2

# Wait and check status (reduced wait time)
echo ""
echo "⏳ Waiting for services to initialize..."
sleep 2

echo ""
echo "📊 Service Status:"
echo ""

# Check Backend API
if curl -s http://localhost:8000/api/v1/health 2>/dev/null | grep -q "ok"; then
    echo "✅ Backend API: http://localhost:8000 - Ready"
else
    echo "⏳ Backend API: Starting..."
fi

# Check Tesseract OCR
if curl -s http://localhost:9000/health 2>/dev/null | grep -q "healthy"; then
    echo "✅ Tesseract OCR: http://localhost:9000 - Ready"
else
    echo "⏳ Tesseract OCR: Starting..."
fi

# Check Frontend
if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "✅ Frontend: http://localhost:5173 - Ready"
else
    echo "⏳ Frontend: Starting (may take 5-10 seconds)..."
fi

# Get LAN IP address
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo "🌐 Application URLs:"
echo ""
echo "   Local Access:"
echo "   - Frontend: http://localhost:5173"
echo "   - Backend API: http://localhost:8000"
echo "   - Tesseract OCR: http://localhost:9000"
echo ""
if [ "$LAN_IP" != "localhost" ]; then
  echo "   LAN Access (for other devices):"
  echo "   - Frontend: http://$LAN_IP:5173"
  echo "   - Backend API: http://$LAN_IP:8000"
  echo "   - Tesseract OCR: http://$LAN_IP:9000"
  echo ""
fi
echo "✅ Startup complete! Services running in background."
echo "   To stop: ./stop.sh or kill processes on ports 5173, 8000, 9000"

# ── Auto-reload Chromium on the Pi display (no keyboard needed) ────────────
# Wait a bit more for Vite dev server to be fully ready
sleep 4

# Try X11 (xdotool) first, then Wayland fallback
if [ -n "$DISPLAY" ] && command -v xdotool &>/dev/null; then
    # X11: send Ctrl+Shift+R to the Chromium window
    WID=$(xdotool search --onlyvisible --name "Chromium" 2>/dev/null | head -1)
    if [ -n "$WID" ]; then
        xdotool key --window "$WID" ctrl+shift+r 2>/dev/null
        echo "🔄 Browser refreshed (X11/xdotool)"
    fi
elif command -v chromium &>/dev/null || command -v chromium-browser &>/dev/null; then
    # Wayland/fallback: navigate to URL (opens new tab or reloads via remote debug)
    CHROMIUM_CMD=$(command -v chromium || command -v chromium-browser)
    DISPLAY=:0 "$CHROMIUM_CMD" "http://localhost:5173" 2>/dev/null &
    echo "🔄 Browser reloaded (Chromium navigate)"
fi
