# 🍓 MUNEEM on Raspberry Pi 5 — Setup Guide

**Hardware:** Raspberry Pi 5 · 10.1" Touchscreen Display  
**Time:** ~30 minutes  
**Repo:** https://github.com/siddhu2004bhagat/muneem2test.git

---

## 🛒 What You Need

| Item | Spec |
|------|------|
| Raspberry Pi 5 | 4GB or 8GB RAM |
| Power Adapter | **Official Pi 5 adapter — 5V/5A USB-C** (MUST use official) |
| microSD Card | 32GB+ Class 10 / A2 |
| 10.1" Display | HDMI touchscreen (1280×800 recommended) |
| Internet | WiFi or Ethernet (for setup only) |

---

## 📀 Step 1 — Flash Raspberry Pi OS

1. Download **[Raspberry Pi Imager](https://www.raspberrypi.com/software/)**
2. Choose OS: **Raspberry Pi OS (64-bit) — Bookworm**
3. Flash to microSD card
4. **Before flashing**, click ⚙️ in Imager and set:
   - Hostname: `muneem`
   - Enable SSH ✅
   - Set username/password
   - Configure WiFi (if using)
5. Boot the Pi and complete initial setup

---

## 📦 Step 2 — Clone the Repository

SSH into your Pi or open a terminal:

```bash
cd ~
git clone https://github.com/siddhu2004bhagat/muneem2test.git muneem
cd muneem
```

---

## 🚀 Step 3 — Run Pi 5 Setup Script (One Command)

```bash
bash scripts/pi5-setup.sh
```

**What it does automatically:**
- ✅ Updates system packages
- ✅ Installs Node.js 20 LTS, Python 3, Git, Tesseract OCR
- ✅ Configures your 10.1" display (1280×800 @ 60Hz)
- ✅ Installs all app dependencies (npm + Python)
- ✅ Sets up kiosk auto-start on boot
- ✅ Disables screen blanking

**Time:** ~15–20 minutes

---

## ▶️ Step 4 — Start the App

### Option A — Manual Start (for testing)

```bash
./start.sh
```

Then open Chromium and go to: **http://localhost:5173**

### Option B — Kiosk Mode (fullscreen, no browser UI)

```bash
bash scripts/pi5-kiosk.sh
```

The app launches in fullscreen with touch input enabled.

### Option C — Auto-start on Boot (already configured by setup script)

```bash
sudo reboot
```

After reboot, the app will auto-launch fullscreen in kiosk mode. ✅

---

## 🖥️ Display Configuration

The setup script configures your display as **1280×800 @ 60Hz** which is standard for most 10.1" HDMI displays.

**If your display shows wrong resolution**, edit:

```bash
sudo nano /boot/firmware/config.txt
```

Find the `muneem-display-config` section and change `hdmi_mode`:

| Resolution | hdmi_mode | Use For |
|------------|-----------|---------|
| 1280×800   | `28`      | Most 10.1" displays ✅ |
| 1024×768   | `16`      | Older displays |
| Custom     | `87`      | Use `hdmi_cvt` line |

For a custom resolution (e.g. 1024×600):
```
hdmi_mode=87
hdmi_cvt=1024 600 60 6 0 0 0
```

---

## 🔧 Troubleshooting

### Services won't start
```bash
# View logs
cat /tmp/backend.log
cat /tmp/frontend.log
cat /tmp/ocr_service.log

# Restart
./stop.sh && ./start.sh
```

### Touch screen not responding
```bash
sudo apt install evtest
sudo evtest   # Select your touch device and test
```

### Under-voltage warning (⚡ icon)
Use the **official Raspberry Pi 5 USB-C power adapter** only.

### Display not detected / black screen
```bash
# Check current display config
cat /boot/firmware/config.txt
# Try forcing HDMI
sudo raspi-config → Display Options → Set resolution
```

### App is slow
Pi 5 runs the app well. If slow:
- Check temperature: `vcgencmd measure_temp` (should be < 70°C)
- Make sure you're using a good quality microSD card (A2 rated)

---

## 🔌 Quick Reference Commands

```bash
# Start app
./start.sh

# Stop app
./stop.sh

# Start kiosk mode
bash scripts/pi5-kiosk.sh

# Health checks
curl http://localhost:8000/api/v1/health   # Backend
curl http://localhost:9000/health          # OCR
curl http://localhost:5173                 # Frontend

# Check Pi temperature
vcgencmd measure_temp

# Check Pi model
cat /proc/device-tree/model

# View logs
cat /tmp/backend.log
cat /tmp/ocr_service.log
```

---

## 📋 Service URLs

| Service | URL |
|---------|-----|
| **App (Frontend)** | http://localhost:5173 |
| **Backend API** | http://localhost:8000 |
| **OCR Service** | http://localhost:9000 |

---

*Last Updated: February 2026 · Raspberry Pi 5 + 10.1" Touchscreen*
