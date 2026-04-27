# Smart Factory Power Diagnostics

This installs persistent journald storage plus a small power marker service.

It cannot log after power has already disappeared, but it does preserve the
evidence leading up to the cut and records whether the previous run ended
cleanly.

## Install On The Pi

From the repo on the Pi:

```bash
cd ~/sf2
git pull
sudo bash scripts/install_power_diagnostics.sh
sudo systemctl restart smart-factory.service
```

## What It Logs

- Persistent systemd journal in `/var/log/journal`.
- A boot marker and clean shutdown marker.
- An alert on the next boot if the previous run did not shut down cleanly.
- Raspberry Pi `vcgencmd get_throttled`, temperature, and core voltage every 5 minutes.
- Kernel evidence such as undervoltage, watchdog, thermal, MMC errors, and EXT4 recovery messages.
- pstore kernel panic records if the firmware/kernel exposes them.

## Useful Commands

```bash
journalctl --list-boots --no-pager
journalctl -b -1 -p warning..alert --no-pager
journalctl -b -1 -k --no-pager
journalctl -t smart-factory-power --no-pager
journalctl -u smart-factory.service -b -1 --no-pager
vcgencmd get_throttled
```

After an unclean power loss, expect to see messages like:

```text
ALERT: previous run appears unclean
EXT4-fs (...): orphan cleanup on readonly fs
rootfs: recovering journal
```
