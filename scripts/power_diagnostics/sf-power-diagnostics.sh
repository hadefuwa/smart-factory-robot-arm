#!/bin/sh
set -eu

STATE_DIR=/var/lib/smart-factory/power-diagnostics

mkdir -p "$STATE_DIR"

log() {
    logger -t smart-factory-power -- "$*"
    echo "$*"
}

boot_id() {
    cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown
}

now_iso() {
    date --iso-8601=seconds 2>/dev/null || date
}

run_token() {
    printf '%s:%s:%s' "$(boot_id)" "$(date +%s 2>/dev/null || echo 0)" "$$"
}

log_kernel_evidence() {
    journalctl -b -0 -k --no-pager 2>/dev/null \
        | grep -Ei 'under-voltage|undervoltage|thrott|EXT4-fs.*orphan|recovering journal|watchdog|thermal|power|I/O error|mmc.*error' \
        | tail -20 \
        | while IFS= read -r line; do
            log "Boot evidence: $line"
        done
}

current_boot="$(boot_id)"

case "${1:-snapshot}" in
    boot)
        previous_run=""
        previous_clean=""

        [ -f "$STATE_DIR/current-run" ] && previous_run="$(cat "$STATE_DIR/current-run" 2>/dev/null || true)"
        [ -f "$STATE_DIR/clean-run" ] && previous_clean="$(cat "$STATE_DIR/clean-run" 2>/dev/null || true)"

        if [ -n "$previous_run" ] && [ "$previous_run" != "$previous_clean" ]; then
            log "ALERT: previous run appears unclean. previous_run=$previous_run last_clean=$previous_clean current_boot=$current_boot time=$(now_iso)"
        else
            log "Previous run was marked clean. previous_run=${previous_run:-none} current_boot=$current_boot time=$(now_iso)"
        fi

        new_run="$(run_token)"
        printf '%s' "$new_run" > "$STATE_DIR/current-run"
        printf '%s %s\n' "$(now_iso)" "$new_run" >> "$STATE_DIR/boot-history.log"
        ;;
    shutdown)
        if [ -f "$STATE_DIR/current-run" ]; then
            cp "$STATE_DIR/current-run" "$STATE_DIR/clean-run"
            clean_run="$(cat "$STATE_DIR/current-run" 2>/dev/null || true)"
        else
            clean_run="$current_boot:unknown"
            printf '%s' "$clean_run" > "$STATE_DIR/clean-run"
        fi

        printf '%s %s\n' "$(now_iso)" "$clean_run" >> "$STATE_DIR/clean-shutdown-history.log"
        log "Clean shutdown marker written for run=$clean_run time=$(now_iso)"
        exit 0
        ;;
    snapshot)
        ;;
    *)
        echo "usage: $0 {boot|shutdown|snapshot}" >&2
        exit 2
        ;;
esac

if command -v vcgencmd >/dev/null 2>&1; then
    throttled="$(vcgencmd get_throttled 2>/dev/null || true)"
    temp="$(vcgencmd measure_temp 2>/dev/null || true)"
    volts="$(vcgencmd measure_volts core 2>/dev/null || true)"

    log "Power snapshot: boot=$current_boot uptime=$(cut -d' ' -f1 /proc/uptime) $throttled $temp $volts"

    if [ -n "$throttled" ] && [ "$throttled" != "throttled=0x0" ]; then
        log "ALERT: Raspberry Pi throttling/undervoltage flags present: $throttled"
    fi
else
    log "Power snapshot: boot=$current_boot uptime=$(cut -d' ' -f1 /proc/uptime) vcgencmd=unavailable"
fi

if [ -d /sys/fs/pstore ] && find /sys/fs/pstore -type f | grep -q .; then
    log "ALERT: pstore contains kernel panic/crash records: $(find /sys/fs/pstore -type f -printf '%f ' 2>/dev/null)"
fi

log_kernel_evidence
