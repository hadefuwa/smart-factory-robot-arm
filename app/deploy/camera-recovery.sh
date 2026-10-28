#!/usr/bin/env bash
set -euo pipefail

# Camera recovery watchdog for Raspberry Pi.
# Recovery sequence:
# 1) Check /api/camera/status
# 2) Restart backend service
# 3) USB unbind/bind camera device and restart backend
# 4) Optional reboot (disabled by default)

API_URL="${API_URL:-https://127.0.0.1:8080/api/camera/status}"
SERVICE_NAME="${SERVICE_NAME:-smart-factory.service}"
USB_PORT="${USB_PORT:-3-1}"
ALLOW_REBOOT_ON_FAILURE="${ALLOW_REBOOT_ON_FAILURE:-0}"
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-3}"

log() {
  logger -t camera-recovery "$*"
  echo "$(date '+%F %T') camera-recovery: $*"
}

camera_ok() {
  local payload
  payload="$(curl -sk --connect-timeout "${CONNECT_TIMEOUT}" --max-time "${CONNECT_TIMEOUT}" "${API_URL}" || true)"
  # 'can_read' can be false when no recent frame has been requested yet.
  # For watchdog purposes, consider camera healthy when backend reports connected.
  [[ "${payload}" == *'"connected":true'* ]]
}

restart_backend() {
  log "Restarting ${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
  sleep 3
}

rebind_usb() {
  if [[ ! -e "/sys/bus/usb/drivers/usb/unbind" ]]; then
    log "USB unbind path missing; cannot rebind"
    return 1
  fi
  log "Rebinding USB camera on port ${USB_PORT}"
  echo "${USB_PORT}" > /sys/bus/usb/drivers/usb/unbind || true
  sleep 2
  echo "${USB_PORT}" > /sys/bus/usb/drivers/usb/bind || true
  sleep 3
}

main() {
  if camera_ok; then
    exit 0
  fi

  log "Camera unhealthy, starting recovery sequence"

  restart_backend
  if camera_ok; then
    log "Recovery succeeded after backend restart"
    exit 0
  fi

  rebind_usb || true
  restart_backend
  if camera_ok; then
    log "Recovery succeeded after USB rebind"
    exit 0
  fi

  log "Recovery failed (camera still unhealthy)"
  if [[ "${ALLOW_REBOOT_ON_FAILURE}" == "1" ]]; then
    log "Reboot escalation enabled. Rebooting now."
    /sbin/reboot
  fi
  exit 1
}

main "$@"
