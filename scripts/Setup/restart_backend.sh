#!/bin/bash
# Restart the Smart Factory backend on the Pi (systemd service). Run on the Pi.
# Code is deployed from Windows with scp - see CLAUDE.md "Deployment workflow".
find ~/sf2 -type d -name "__pycache__" -not -path "*/venv/*" -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null
sudo systemctl restart smart-factory.service
sleep 3
systemctl is-active smart-factory.service
