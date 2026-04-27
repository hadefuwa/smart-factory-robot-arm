#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POWER_DIR="$SCRIPT_DIR/power_diagnostics"

if [ ! -f "$POWER_DIR/sf-power-diagnostics.sh" ]; then
    echo "Power diagnostics files not found at $POWER_DIR" >&2
    exit 1
fi

sudo install -d -m 0755 /usr/local/sbin
sudo install -d -m 0755 /etc/systemd/system
sudo install -d -m 0755 /etc/systemd/journald.conf.d
sudo install -d -m 0755 /var/lib/smart-factory/power-diagnostics
sudo install -d -m 2755 -g systemd-journal /var/log/journal

sudo install -m 0755 "$POWER_DIR/sf-power-diagnostics.sh" /usr/local/sbin/sf-power-diagnostics
sudo install -m 0644 "$POWER_DIR/sf-power-marker.service" /etc/systemd/system/sf-power-marker.service
sudo install -m 0644 "$POWER_DIR/sf-power-snapshot.service" /etc/systemd/system/sf-power-snapshot.service
sudo install -m 0644 "$POWER_DIR/sf-power-snapshot.timer" /etc/systemd/system/sf-power-snapshot.timer
sudo install -m 0644 "$POWER_DIR/99-persistent-smart-factory.conf" /etc/systemd/journald.conf.d/99-persistent-smart-factory.conf

sudo systemctl daemon-reload
sudo systemctl restart systemd-journald
sudo journalctl --flush || true
sudo systemctl enable --now sf-power-marker.service sf-power-snapshot.timer
sudo systemctl start sf-power-snapshot.service

echo "Smart Factory power diagnostics installed."
echo "Check logs with: journalctl -t smart-factory-power --no-pager"
