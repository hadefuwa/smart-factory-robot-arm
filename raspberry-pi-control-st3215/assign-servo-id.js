/**
 * Assign a new ID to an ST3215 servo.
 *
 * BEFORE RUNNING:
 *   1. Disconnect ALL other servos from the bus — leave ONLY the new servo connected.
 *   2. Make sure the smart-factory service is stopped so it doesn't hold the port:
 *        sudo systemctl stop smart-factory.service
 *
 * Usage:
 *   node assign-servo-id.js [targetId] [serialPort]
 *
 * Defaults:
 *   targetId   = 6            (the ID you want the new servo to have)
 *   serialPort = /dev/ttyACM0 (the SC-B1 serial adapter)
 *
 * Example — assign ID 6 via /dev/ttyACM0:
 *   node assign-servo-id.js 6 /dev/ttyACM0
 */

const { SerialPort } = require('serialport');

const TARGET_ID   = parseInt(process.argv[2] || '6', 10);
const SERIAL_PORT = process.argv[3] || '/dev/ttyACM0';
const BAUDRATE    = 1000000;

// ST3215 register addresses (Feetech SCS/ST protocol)
const STS_ID         = 5;   // EEPROM: servo ID
const STS_LOCK       = 55;  // RAM: EEPROM write lock (0 = unlocked, 1 = locked)

const SCAN_MAX_ID    = 20;  // Scan IDs 1-20 to locate the new servo
const PING_TIMEOUT   = 200; // ms to wait for a ping response

// ─── minimal protocol ──────────────────────────────────────────────────────

const PKT_ID          = 2;
const PKT_LENGTH      = 3;
const PKT_INSTRUCTION = 4;
const PKT_PARAMETER0  = 5;
const INST_PING       = 1;
const INST_WRITE      = 3;

let port;
let rxBuffer = Buffer.alloc(0);
let pendingResolve = null;
let pendingTimeout = null;
let expectedId = null;

function buildPacket(servoId, instruction, params = []) {
    const length = 2 + params.length;
    const pkt = Buffer.alloc(4 + length);
    pkt[0] = 0xFF;
    pkt[1] = 0xFF;
    pkt[PKT_ID]          = servoId;
    pkt[PKT_LENGTH]      = length;
    pkt[PKT_INSTRUCTION] = instruction;
    for (let i = 0; i < params.length; i++) pkt[PKT_PARAMETER0 + i] = params[i];
    let cs = 0;
    for (let i = PKT_ID; i < PKT_PARAMETER0 + params.length; i++) cs += pkt[i];
    pkt[PKT_PARAMETER0 + params.length] = (~cs) & 0xFF;
    return pkt;
}

function tryParseResponse(buf) {
    if (buf.length < 6) return null;
    if (buf[0] !== 0xFF || buf[1] !== 0xFF) return null;
    const id  = buf[PKT_ID];
    const len = buf[PKT_LENGTH];
    const expected = len + 4;
    if (buf.length < expected) return null;
    let cs = 0;
    for (let i = PKT_ID; i < expected - 1; i++) cs += buf[i];
    if (((~cs) & 0xFF) !== buf[expected - 1]) return null;
    return { id, error: buf[4] };
}

function onData(data) {
    rxBuffer = Buffer.concat([rxBuffer, data]);
    if (!pendingResolve) return;
    const pkt = tryParseResponse(rxBuffer);
    if (pkt && pkt.id === expectedId) {
        clearTimeout(pendingTimeout);
        const res = pendingResolve;
        pendingResolve = null;
        pendingTimeout = null;
        rxBuffer = Buffer.alloc(0);
        res(pkt);
    }
}

function sendAndWait(servoId, instruction, params, timeoutMs) {
    return new Promise((resolve) => {
        rxBuffer = Buffer.alloc(0);
        expectedId = servoId;
        pendingResolve = resolve;
        pendingTimeout = setTimeout(() => {
            if (pendingResolve) {
                pendingResolve = null;
                resolve(null); // timeout = no response
            }
        }, timeoutMs);
        port.write(buildPacket(servoId, instruction, params));
    });
}

async function ping(servoId) {
    const r = await sendAndWait(servoId, INST_PING, [], PING_TIMEOUT);
    return r !== null && r.error === 0;
}

async function writeByte(servoId, address, value) {
    // fire-and-forget write — ST3215 may not return an ACK
    port.write(buildPacket(servoId, INST_WRITE, [address & 0xFF, value & 0xFF]));
    await delay(20);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
    if (isNaN(TARGET_ID) || TARGET_ID < 1 || TARGET_ID > 253) {
        console.error('ERROR: targetId must be 1-253');
        process.exit(1);
    }

    console.log('');
    console.log('ST3215 Servo ID Assignment');
    console.log('==========================');
    console.log(`Serial port : ${SERIAL_PORT}`);
    console.log(`Target ID   : ${TARGET_ID}`);
    console.log('');
    console.log('WARNING: make sure ONLY the new servo is connected to the bus.');
    console.log('         All other servos should be unplugged from the chain.');
    console.log('');

    // Open port
    port = new SerialPort({ path: SERIAL_PORT, baudRate: BAUDRATE, autoOpen: false });
    port.on('data', onData);
    port.on('error', e => { console.error('Serial error:', e.message); process.exit(1); });

    await new Promise((resolve, reject) => {
        port.open(err => err ? reject(err) : resolve());
    });
    console.log(`Opened ${SERIAL_PORT} at ${BAUDRATE} baud.`);
    await delay(300); // let bus settle

    // Flush
    await new Promise(res => port.flush(err => res()));
    await delay(100);

    // Scan
    console.log(`Scanning IDs 1-${SCAN_MAX_ID}...`);
    const found = [];
    for (let id = 1; id <= SCAN_MAX_ID; id++) {
        const ok = await ping(id);
        if (ok) {
            console.log(`  Found servo at ID ${id}`);
            found.push(id);
        }
        await delay(30);
    }

    if (found.length === 0) {
        console.error('');
        console.error('ERROR: No servo found on IDs 1-' + SCAN_MAX_ID + '.');
        console.error('Check wiring, power supply, and serial port path.');
        port.close();
        process.exit(1);
    }

    if (found.length > 1) {
        console.error('');
        console.error(`ERROR: Found ${found.length} servos (IDs ${found.join(', ')}).`);
        console.error('Disconnect all other servos so only the new one is on the bus, then retry.');
        port.close();
        process.exit(1);
    }

    const currentId = found[0];
    if (currentId === TARGET_ID) {
        console.log('');
        console.log(`Servo is already at ID ${TARGET_ID}. Nothing to do.`);
        port.close();
        return;
    }

    console.log('');
    console.log(`Changing servo ID from ${currentId} → ${TARGET_ID}...`);

    // Unlock EEPROM (write 0 to STS_LOCK)
    await writeByte(currentId, STS_LOCK, 0);
    await delay(20);

    // Write new ID to EEPROM register 5
    await writeByte(currentId, STS_ID, TARGET_ID);
    await delay(50); // EEPROM write needs extra settle time

    // Re-lock EEPROM (write 1 to STS_LOCK, using new ID)
    await writeByte(TARGET_ID, STS_LOCK, 1);
    await delay(20);

    // Verify
    console.log(`Verifying new ID ${TARGET_ID}...`);
    const verified = await ping(TARGET_ID);
    if (verified) {
        console.log('');
        console.log(`SUCCESS: Servo now responds at ID ${TARGET_ID}.`);
        console.log('');
        console.log('Next steps:');
        console.log('  1. Reconnect all servos to the bus.');
        console.log('  2. Restart the service:');
        console.log('       sudo systemctl restart smart-factory.service');
    } else {
        console.warn('');
        console.warn(`WARNING: Servo did not respond at new ID ${TARGET_ID} immediately.`);
        console.warn('Try power-cycling the servo — the new ID may need a restart to take effect.');
        console.warn(`Then verify with: node assign-servo-id.js ${TARGET_ID} ${SERIAL_PORT}`);
    }

    port.close();
}

main().catch(e => {
    console.error('Fatal error:', e.message);
    if (port && port.isOpen) port.close();
    process.exit(1);
});
