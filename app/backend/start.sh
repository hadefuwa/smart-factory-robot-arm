#!/bin/bash
# Startup script for PWA Dobot-PLC Backend
# Ensures backend runs on port 8080

cd "$(dirname "$0")"

# Set port to 8080
export PORT=8080

# Digital twin stream disabled to reduce CPU usage
export ENABLE_DIGITAL_TWIN_STREAM=0

# Kill any existing instances
pkill -f "python.*app.py"
sleep 1

# Start backend
echo "Starting backend on port $PORT (Digital Twin DISABLED)..."
python3 app.py 2>&1 | tee backend.log
