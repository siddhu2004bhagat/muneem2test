#!/bin/bash

# MUNEEM OS-Level Touchscreen Fix for Raspberry Pi 5 (Bookworm / Wayland)
# This script forces the OS input stack (udev -> libinput -> wayland) 
# to classify generic HDMI USB touchscreens as true touch devices,
# preventing them from being emulated as a mouse.

echo "🔍 Scanning for common touchscreen devices in /proc/bus/input/devices..."

if grep -qi -E 'touch|waveshare|ilitek|goodix|egalax' /proc/bus/input/devices; then
    echo "✅ Touchscreen signature found in kernel input devices."
else
    echo "⚠️ Typical touchscreen name not found, applying generic fallback rules."
fi

echo "📝 Writing custom udev rules to /etc/udev/rules.d/99-muneem-touch.rules..."

sudo bash -c 'cat > /etc/udev/rules.d/99-muneem-touch.rules << "EOF"
# MUNEEM: Force specific USB HID touchscreens to drop the mouse emulation
# and be strictly recognized as touchscreens by libinput and Wayland.

SUBSYSTEM=="input", KERNEL=="event[0-9]*", ENV{ID_INPUT_MOUSE}=="1", ENV{ID_INPUT}=="1", ATTRS{name}=="*Touch*", ENV{ID_INPUT_TOUCHSCREEN}="1", ENV{ID_INPUT_MOUSE}=""
SUBSYSTEM=="input", KERNEL=="event[0-9]*", ENV{ID_INPUT_MOUSE}=="1", ENV{ID_INPUT}=="1", ATTRS{name}=="*WaveShare*", ENV{ID_INPUT_TOUCHSCREEN}="1", ENV{ID_INPUT_MOUSE}=""
SUBSYSTEM=="input", KERNEL=="event[0-9]*", ENV{ID_INPUT_MOUSE}=="1", ENV{ID_INPUT}=="1", ATTRS{name}=="*ILITEK*", ENV{ID_INPUT_TOUCHSCREEN}="1", ENV{ID_INPUT_MOUSE}=""
SUBSYSTEM=="input", KERNEL=="event[0-9]*", ENV{ID_INPUT_MOUSE}=="1", ENV{ID_INPUT}=="1", ATTRS{name}=="*eGalax*", ENV{ID_INPUT_TOUCHSCREEN}="1", ENV{ID_INPUT_MOUSE}=""
SUBSYSTEM=="input", KERNEL=="event[0-9]*", ENV{ID_INPUT_MOUSE}=="1", ENV{ID_INPUT}=="1", ATTRS{name}=="*Goodix*", ENV{ID_INPUT_TOUCHSCREEN}="1", ENV{ID_INPUT_MOUSE}=""
EOF'

echo "🔄 Reloading udev rules..."
sudo udevadm control --reload-rules
sudo udevadm trigger

echo ""
echo "✅ OS-Level Touchscreen Fix Applied!"
echo "⚠️  CRITICAL: You MUST reboot for libinput and Wayland to register the new interface class."
echo "    Run: sudo reboot"
echo ""
