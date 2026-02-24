# DigBahi Application Requirements & Deployment Guide

This document outlines the hardware, software, and dependency requirements needed to run the DigBahi (MUNEEM) application on a local development machine or a Raspberry Pi tablet.

---

## 1. Hardware Requirements

### Development Device (Mac / Windows / Linux PC)
- **RAM**: Minimum 8GB (16GB recommended for active development)
- **Storage**: Minimum 2GB free space
- **Processor**: Multi-core processor (Intel i5/M1 or equivalent)

### Production Device (Raspberry Pi)
- **Model**: Raspberry Pi 4 (4GB+ RAM) or Raspberry Pi 5
- **Power**: Official 5V 3A (Pi 4) or 5V 5A (Pi 5) power supply. *(Warning: 3rd party adapters may cause under-voltage throttling)*
- **Storage**: 32GB+ Class 10 microSD card
- **Display**: 7" to 10" Touchscreen Display

---

## 2. System Software Dependencies

Before installing application packages, your operating system must have the following core software installed:

### Linux / Raspberry Pi OS (Debian-based)
Run the following single command to install all necessary system packages:
```bash
sudo apt update && sudo apt install -y \
    python3.10 \
    python3.10-venv \
    python3-pip \
    nodejs \
    npm \
    git \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-hin \
    libtesseract-dev \
    libleptonica-dev \
    build-essential
```

**Note on Node.js**: The application requires **Node.js 18 or higher**. If `apt` installs an older version, upgrade using NodeSource:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

### macOS / Windows
- **Node.js**: v18+ (Download from [nodejs.org](https://nodejs.org))
- **Python**: v3.8 to v3.11 (Download from [python.org](https://python.org))
- **Tesseract OCR (Optional but recommended)**: 
  - Mac: `brew install tesseract tesseract-lang`
  - Windows: Use the [UB-Mannheim Windows Installer](https://github.com/UB-Mannheim/tesseract/wiki)

---

## 3. Application Dependencies

The application is split into a React/Vite Frontend and a FastAPI Backend. 

### Frontend (`package.json`)
- React 18, TypeScript, TailwindCSS, Shadcn UI
- Tesseract.js & TensorFlow.js (@tensorflow/tfjs) for browser-based OCR
- IndexedDB wrapper (Dexie) for local storage

**Installation**:
```bash
# In the root repository directory
npm install
```

### Backend (`backend/requirements.txt`)
- FastAPI, Uvicorn (Server)
- SQLAlchemy, Alembic (Database)
- Cryptography, Passlib (Security)
- Pyserial, psutil (Hardware interaction)
- Requests (WhatsApp API Integration)

**Installation**:
```bash
# In the repository root directory
cd backend
python3 -m venv venv
source venv/bin/activate  # Or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
```

---

## 4. Quick Deployment Workflow

Once the system prerequisites are met (Git, Python, Node), setting up and running the application on a new device is extremely simple using the provided bash scripts.

### Step 1: Clone the Repository
```bash
git clone https://github.com/soni-pvt-ltd/DigBahi.git
cd DigBahi
```

### Step 2: One-Click Installation
The install script will automatically setup the Python virtual environment, install PIP requirements, and run `npm install`.
```bash
chmod +x install.sh
./install.sh
```

### Step 3: Start the Application
The start script boots up the Frontend (Vite), Backend API (FastAPI), and optional OCR backend concurrently.
```bash
chmod +x start.sh
./start.sh
```

### Step 4: Access the Application
- Open a browser and navigate to: `http://localhost:5173`
- Default Login PIN: `1234` (Demo user)
