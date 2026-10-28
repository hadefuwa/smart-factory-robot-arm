#!/bin/bash
# Set up the Python environment for the Smart Factory backend (run on the Pi).
# The repo lives at ~/sf2. The backend runs as the systemd service
# smart-factory.service (see deploy/smart-factory.service) - not under PM2.

echo "Installing Smart Factory backend dependencies..."
echo ""

# Install system dependencies
echo "Installing system packages..."
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv

# Create virtual environment
echo "Creating Python virtual environment..."
cd ~/sf2/app/backend
python3 -m venv venv

# Activate and install Python packages
echo "Installing Python dependencies..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Serial port permissions (arm bridge / USB devices)
echo "Setting up serial permissions..."
sudo usermod -a -G dialout $USER

# Create logs directory
mkdir -p ~/logs

echo ""
echo "Installation complete."
echo ""
echo "Next steps:"
echo "  1. Install the services:"
echo "       sudo cp ~/sf2/app/deploy/smart-factory.service ~/sf2/app/deploy/vision.service \\"
echo "               ~/sf2/app/robotarmv3-pi-service/robotarmv3-pi.service /etc/systemd/system/"
echo "       sudo systemctl daemon-reload"
echo "       sudo systemctl enable --now smart-factory.service vision.service robotarmv3-pi.service"
echo "  2. Open https://<pi-ip>:8080 in a browser"
echo ""
