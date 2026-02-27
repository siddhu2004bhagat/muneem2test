#!/bin/bash

# MUNEEM - Raspberry Pi 5 Setup Script
# Optimized for Raspberry Pi 5 with 10.1" touchscreen display
# Run this ONCE after cloning the repo on your Pi 5

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   MUNEEM - Raspberry Pi 5 Setup Script       ║${NC}"
echo -e "${BLUE}║   For 10.1\" Touchscreen Display              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."
APP_DIR=$(pwd)

# ─────────────────────────────────────────────
# STEP 1: System Update
# ─────────────────────────────────────────────
echo -e "${YELLOW}📦 Step 1: Updating system packages...${NC}"
sudo apt update && sudo apt upgrade -y
echo -e "${GREEN}✅ System updated${NC}"
echo ""

# ─────────────────────────────────────────────
# STEP 2: Install System Dependencies
# ─────────────────────────────────────────────
echo -e "${YELLOW}📦 Step 2: Installing system dependencies...${NC}"
sudo apt install -y \
    python3 \
    python3-venv \
    python3-pip \
    git \
    curl \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-hin \
    libtesseract-dev \
    libleptonica-dev \
    build-essential \
    libgl1-mesa-glx \
    libglib2.0-0 \
    chromium-browser \
    x11-xserver-utils \
    unclutter \
    xdotool \
    wmctrl
echo -e "${GREEN}✅ System dependencies installed${NC}"
echo ""

# ─────────────────────────────────────────────
# STEP 3: Install Node.js 20 (LTS, best for Pi 5)
# ─────────────────────────────────────────────
echo -e "${YELLOW}📦 Step 3: Installing Node.js 20 LTS...${NC}"
NODE_VERSION_OK=false
if command -v node &>/dev/null; then
    CURRENT_NODE=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$CURRENT_NODE" -ge 18 ]; then
        NODE_VERSION_OK=true
        echo -e "${GREEN}✅ Node.js $(node --version) already installed${NC}"
    fi
fi

if [ "$NODE_VERSION_OK" = false ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    echo -e "${GREEN}✅ Node.js $(node --version) installed${NC}"
fi
echo ""

# ─────────────────────────────────────────────
# STEP 4: Configure 10.1" Display (Resolution)
# ─────────────────────────────────────────────
echo -e "${YELLOW}🖥️  Step 4: Configuring 10.1\" display resolution...${NC}"

# Common 10.1" resolution is 1280x800 or 1024x600
# We set 1280x800 which is most common for 10.1" HDMI displays
BOOT_CONFIG="/boot/firmware/config.txt"
if [ ! -f "$BOOT_CONFIG" ]; then
    BOOT_CONFIG="/boot/config.txt"
fi

if ! grep -q "muneem-display-config" "$BOOT_CONFIG"; then
    echo "" | sudo tee -a "$BOOT_CONFIG" > /dev/null
    echo "# muneem-display-config" | sudo tee -a "$BOOT_CONFIG" > /dev/null
    echo "hdmi_force_hotplug=1" | sudo tee -a "$BOOT_CONFIG" > /dev/null
    echo "hdmi_group=2" | sudo tee -a "$BOOT_CONFIG" > /dev/null
    echo "hdmi_mode=28" | sudo tee -a "$BOOT_CONFIG" > /dev/null  # 1280x800 @60Hz
    echo "display_rotate=0" | sudo tee -a "$BOOT_CONFIG" > /dev/null
    echo -e "${GREEN}✅ Display configured (1280x800 @ 60Hz)${NC}"
else
    echo -e "${BLUE}   Display config already set${NC}"
fi
echo ""

# ─────────────────────────────────────────────
# STEP 5: Install App Dependencies
# ─────────────────────────────────────────────
echo -e "${YELLOW}📦 Step 5: Installing application dependencies...${NC}"
cd "$APP_DIR"
bash install.sh
echo ""

# ─────────────────────────────────────────────
# STEP 6: Set up Kiosk Mode Auto-Start
# ─────────────────────────────────────────────
echo -e "${YELLOW}🖥️  Step 6: Setting up kiosk mode auto-start...${NC}"

AUTOSTART_DIR="$HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

cat > "$AUTOSTART_DIR/muneem-kiosk.desktop" << EOF
[Desktop Entry]
Type=Application
Name=MUNEEM Kiosk
Exec=bash $APP_DIR/scripts/pi5-kiosk.sh
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

echo -e "${GREEN}✅ Kiosk auto-start configured${NC}"
echo ""

# ─────────────────────────────────────────────
# STEP 7: Configure Touch Screen (if needed)
# ─────────────────────────────────────────────
echo -e "${YELLOW}🖐️  Step 7: Configuring touchscreen...${NC}"
# Install xinput calibration tools
sudo apt install -y xinput libinput-tools 2>/dev/null || true

# Disable touchscreen cursor (optional, uncomment if needed)
# sudo apt install -y unclutter
echo -e "${GREEN}✅ Touch input tools installed${NC}"
echo ""

# ─────────────────────────────────────────────
# STEP 8: Disable Screen Blanking on Boot
# ─────────────────────────────────────────────
echo -e "${YELLOW}⚙️  Step 8: Disabling screen blanking...${NC}"

# For LXDE/Wayfire
LXDE_AUTOSTART="$HOME/.config/lxsession/LXDE-pi/autostart"
mkdir -p "$(dirname $LXDE_AUTOSTART)"
if ! grep -q "xset s off" "$LXDE_AUTOSTART" 2>/dev/null; then
    echo "@xset s off" >> "$LXDE_AUTOSTART"
    echo "@xset -dpms" >> "$LXDE_AUTOSTART"
    echo "@xset s noblank" >> "$LXDE_AUTOSTART"
fi

echo -e "${GREEN}✅ Screen blanking disabled${NC}"
echo ""

# ─────────────────────────────────────────────
# Done!
# ─────────────────────────────────────────────
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ Raspberry Pi 5 Setup Complete!          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📝 Next steps:${NC}"
echo ""
echo -e "   1. Start the app manually:"
echo -e "      ${YELLOW}./start.sh${NC}"
echo ""
echo -e "   2. Start in kiosk mode (fullscreen):"
echo -e "      ${YELLOW}bash scripts/pi5-kiosk.sh${NC}"
echo ""
echo -e "   3. Or reboot to auto-start in kiosk mode:"
echo -e "      ${YELLOW}sudo reboot${NC}"
echo ""
echo -e "   4. Open app in browser:"
echo -e "      ${YELLOW}http://localhost:5173${NC}"
echo ""
echo -e "${BLUE}💡 Display Note:${NC}"
echo -e "   If your 10.1\" display doesn't work, check:"
echo -e "   ${YELLOW}sudo nano /boot/firmware/config.txt${NC}"
echo -e "   and adjust hdmi_mode. Common modes:"
echo -e "     hdmi_mode=28  → 1280x800 @60Hz"
echo -e "     hdmi_mode=16  → 1024x768 @60Hz"
echo -e "     hdmi_mode=87  → custom (use hdmi_cvt)"
echo ""
