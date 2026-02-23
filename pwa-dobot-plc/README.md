# 🤖 PWA Dobot-PLC Control

Beautiful Progressive Web App for controlling Dobot Magician robot via Siemens S7-1200 PLC.

## ✨ Features

- 📱 **Progressive Web App** - Install on any device, works offline
- 🎯 **Real-time Monitoring** - Live PLC data and Dobot position
- 🕹️ **Manual Control** - Direct robot control from web interface
- 🛑 **Emergency Stop** - Quick safety shutdown
- 📊 **Control Bits Display** - Monitor PLC control signals
- 🎨 **Beautiful UI** - Modern, gradient design with emoji indicators
- 📷 **Vision System** - YOLO counter detection, Override Start (bypass PLC DB123.DBX26.0), detection method selector (YOLO/contour/circle/blob)
- ⚙️ **Real-time Parameters** - Adjust confidence, IOU, cropping, edge detection from the UI
- 🔒 **HTTPS** - Self-signed SSL for WinCC Unified HMI (run `deploy/generate_ssl_cert.sh`)

## 🚀 Installation on Raspberry Pi

### 1. Clone the repository
```bash
cd ~
git clone https://github.com/hadefuwa/sf2.git sf2
cd sf2/pwa-dobot-plc/backend
```

### 2. Install System Dependencies
```bash
# Install system packages
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv build-essential

# Install Snap7 library (for PLC communication)
cd ~
wget https://sourceforge.net/projects/snap7/files/1.4.2/snap7-full-1.4.2.tar.gz
tar -zxvf snap7-full-1.4.2.tar.gz
cd snap7-full-1.4.2/build/unix
make -f arm_v7_linux.mk  # For Raspberry Pi 3/4
sudo cp ../bin/arm_v7-linux/libsnap7.so /usr/lib/
sudo ldconfig
```

### 3. Create Virtual Environment and Install Python Packages
```bash
cd ~/sf2/pwa-dobot-plc/backend
python3 -m venv venv
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install Python packages
pip install -r requirements.txt
```

This installs:
- Flask (web server)
- Flask-SocketIO (real-time updates)
- python-snap7 (PLC communication)
- pydobot (Dobot control)
- pyserial (USB communication)

### 4. Configure Dobot USB permissions
```bash
# Add your user to dialout group
sudo usermod -a -G dialout $USER

# Log out and back in, or run:
newgrp dialout

# Find your Dobot device
ls -la /dev/ttyACM*
```

### 5. Configure settings
```bash
# Copy and edit .env file
cp .env.example .env
nano .env
```

Update these values:
- `DOBOT_USB_PATH` - Your Dobot device (usually `/dev/ttyACM1`)
- `PLC_IP` - Your PLC IP address (usually `192.168.1.150`)

### 6. Test the application
```bash
# Make sure you're in the virtual environment
source venv/bin/activate

# Run the server
python app.py
```

Visit `http://your-pi-ip:8080` in your browser!

### 6b. Enable HTTPS (for WinCC Unified HMI)
WinCC Unified requires HTTPS for embedded camera streams. Generate a self-signed certificate:

```bash
cd ~/sf2/pwa-dobot-plc
chmod +x deploy/generate_ssl_cert.sh
./deploy/generate_ssl_cert.sh 192.168.7.5   # use your Pi's IP
pm2 restart pwa-dobot-plc   # or restart your server
```

Then use: `https://192.168.7.5:8080/api/camera/stream` in WinCC. Accept the certificate warning on first load.

### 7. Set up PM2 for auto-start
```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2 (ecosystem.config.js uses sf2 path)
cd ~/sf2/pwa-dobot-plc
pm2 start deploy/ecosystem.config.js

# Save PM2 config
pm2 save

# Set PM2 to start on boot
pm2 startup
# Run the command it gives you (with sudo)

# Check status
pm2 status
pm2 logs pwa-dobot-plc
```

## 🎮 Usage

1. **Open the app** - Navigate to `http://your-pi-ip:8080`
2. **Check connections** - Green dots indicate PLC and Dobot are connected
3. **Monitor data** - See real-time PLC targets and Dobot position
4. **Manual control**:
   - 🏠 **Home** - Send robot to home position
   - ▶️ **Move to Target** - Move robot to PLC target coordinates
   - 🛑 **Emergency Stop** - Immediately stop all movement

## 📱 Install as PWA

On **mobile devices**:
1. Open in Safari (iOS) or Chrome (Android)
2. Tap "Share" → "Add to Home Screen"
3. Launch like a native app!

On **desktop**:
1. Open in Chrome
2. Click the install icon in address bar
3. Use as standalone app!

## 🔧 Troubleshooting

### Dobot not connecting
```bash
# Check USB device
ls -la /dev/ttyACM*
ls -la /dev/ttyUSB*

# Check permissions
groups  # Should include 'dialout'

# Try different device path in .env
DOBOT_USB_PATH=/dev/ttyACM0  # or /dev/ttyACM1
```

### PLC not connecting
```bash
# Test network connection
ping 192.168.1.150

# Check PLC IP in .env
PLC_IP=192.168.1.150
```

### Port already in use
```bash
# Find and kill process on port 8080
sudo lsof -ti:8080 | xargs -r sudo kill -9

# Or change port in .env
PORT=8081
```

## 📋 PLC Memory Map

### DB1 (Data Block)
- **DBD0-11**: Target Position (X, Y, Z) - REAL values

### Merkers (M Memory)
- **M0.0**: Start movement
- **M0.1**: Stop
- **M0.2**: Home
- **M0.3**: Emergency stop
- **M0.4**: Suction cup
- **M0.5**: Ready status
- **M0.6**: Busy status
- **M0.7**: Error status

## 🎨 Features

- ✅ Real-time data updates (2s polling)
- ✅ Offline support (PWA)
- ✅ Mobile-friendly responsive design
- ✅ Auto-reconnect on disconnect
- ✅ Beautiful gradient UI
- ✅ Emoji indicators for status
- ✅ Emergency stop with confirmation

## 📝 License

MIT - Feel free to use and modify!

## 🙏 Credits

- Flask & Flask-SocketIO - Web framework
- python-snap7 - PLC communication
- pydobot - Dobot robot control

