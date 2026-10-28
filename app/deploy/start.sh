#!/bin/bash
# Run the backend in the foreground for development testing (on the Pi).
# Stop the service first so port 8080 is free:  sudo systemctl stop smart-factory.service

cd ~/sf2/app/backend

# Activate virtual environment
if [ ! -d "venv" ]; then
    echo "Virtual environment not found!"
    echo "   Run: ~/sf2/app/deploy/install.sh first"
    exit 1
fi

source venv/bin/activate

echo "Starting Smart Factory backend..."
echo "Server will be available at https://$(hostname -I | awk '{print $1}'):8080"
echo "   Press Ctrl+C to stop"
echo ""

python app.py
