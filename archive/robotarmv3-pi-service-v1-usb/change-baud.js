/**
 * One-time servo baud-rate change utility.
 *
 * Walks the ST3215 daisy chain, broadcasts an EEPROM write to register 0x06
 * (BAUD_RATE), then verifies each servo responds at the new baud. Run while
 * the bridge service (robotarmv3-pi.service) is STOPPED so it can hold the
 * serial port exclusively.
 *
 * Usage:
 *   sudo systemctl stop robotarmv3-pi.service
 *   node change-baud.js [--from <oldBaud>] [--to <newBaud>] [--port /dev/ttyACM0]
 *   sudo systemctl start robotarmv3-pi.service
 *
 * Defaults: --from 1000000 --to 500000 --port /dev/ttyACM0
 *
 * Recovery: if some servos changed and some didn't, re-run with --from <newBaud>
 * --to <oldBaud> to roll back. The script's own ping sweep at the end will tell
 * you which baud each servo is currently at.
 */

const { SerialPort } = require('serialport');
const RobotArm = require('./robotArmST3215');

// ST3215 EEPROM registers
const REG_BAUD_RATE = 0x06;
const REG_LOCK      = 0x37;

// ST3215 baud rate index table (per Feetech STS series datasheet)
const BAUD_INDEX = {
    1000000: 0,
    500000:  1,
    250000:  2,
    128000:  3,
    115200:  4,
    76800:   5,
    57600:   6,
    38400:   7,
};

const BROADCAST_ID = 0xFE;
const SERVO_IDS = [1, 2, 3, 4, 5, 6];

function parseArgs(argv) {
    const args = { from: 1000000, to: 500000, port: '/dev/ttyACM0' };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--from') args.from = parseInt(argv[++i], 10);
        else if (a === '--to') args.to = parseInt(argv[++i], 10);
        else if (a === '--port') args.port = argv[++i];
        else if (a === '--help' || a === '-h') {
            console.log('Usage: node change-baud.js [--from <baud>] [--to <baud>] [--port <path>]');
            process.exit(0);
        }
    }
    return args;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function openPort(path, baudRate) {
    return new Promise((resolve, reject) => {
        const port = new SerialPort({ path, baudRate, dataBits: 8, parity: 'none', stopBits: 1, autoOpen: false });
        port.open((err) => err ? reject(err) : resolve(port));
    });
}

function closePort(port) {
    return new Promise((resolve) => {
        if (!port || !port.isOpen) return resolve();
        port.close(() => resolve());
    });
}

function setPortBaud(port, baudRate) {
    return new Promise((resolve, reject) => {
        port.update({ baudRate }, (err) => err ? reject(err) : resolve());
    });
}

async function pingAll(port, baud) {
    // Set up a controller per ID and ping each. Returns an array of booleans.
    const results = [];
    const controllers = [];
    for (const id of SERVO_IDS) {
        const c = new RobotArm.ServoController(id, port, id, baud);
        controllers.push(c);
    }
    // Single shared data handler that fans out to whichever controller's ID matches
    const onData = (data) => {
        for (const c of controllers) {
            if (c.handleIncomingData) c.handleIncomingData(data);
        }
    };
    port.on('data', onData);
    try {
        for (const c of controllers) {
            // ping() has a 200ms internal timeout
            const ok = await c.ping();
            results.push({ id: c.servoIdNumber, ok });
        }
    } finally {
        port.removeListener('data', onData);
    }
    return results;
}

async function main() {
    const args = parseArgs(process.argv);
    const fromIdx = BAUD_INDEX[args.from];
    const toIdx   = BAUD_INDEX[args.to];

    if (fromIdx === undefined) {
        console.error(`ERROR: --from ${args.from} is not a recognised ST3215 baud. Valid: ${Object.keys(BAUD_INDEX).join(', ')}`);
        process.exit(1);
    }
    if (toIdx === undefined) {
        console.error(`ERROR: --to ${args.to} is not a recognised ST3215 baud. Valid: ${Object.keys(BAUD_INDEX).join(', ')}`);
        process.exit(1);
    }
    if (args.from === args.to) {
        console.error('ERROR: --from and --to are the same. Nothing to do.');
        process.exit(1);
    }

    console.log(`[1/7] Opening ${args.port} at ${args.from} baud (current servo baud)...`);
    let port = await openPort(args.port, args.from);
    console.log(`      Port open.`);

    console.log(`[2/7] Pre-flight: pinging each servo at ${args.from} to confirm starting state...`);
    let pre = await pingAll(port, args.from);
    for (const r of pre) console.log(`      Servo ${r.id}: ${r.ok ? 'OK' : 'NO REPLY'}`);
    const preOk = pre.filter(r => r.ok).length;
    if (preOk === 0) {
        console.error(`ERROR: no servos responded at ${args.from}. Wrong --from or wrong --port. Aborting.`);
        await closePort(port);
        process.exit(2);
    }
    if (preOk < SERVO_IDS.length) {
        console.warn(`WARN: only ${preOk}/${SERVO_IDS.length} responded at ${args.from}. Continuing — silent ones may still receive the broadcast.`);
    }

    console.log(`[3/7] Building broadcast controller (ID 0xFE) and sending EEPROM unlock, baud=${toIdx} (${args.to}), lock...`);
    const broadcaster = new RobotArm.ServoController('BCAST', port, BROADCAST_ID, args.from);
    // Wire data handler so any stray bytes are consumed (broadcast normally elicits no reply)
    const onData = (data) => { /* swallow */ };
    port.on('data', onData);

    try {
        // Unlock EEPROM (write 0 to LOCK)
        await broadcaster.writeData(REG_LOCK, [0]);
        await sleep(20);
        // Write new baud index
        await broadcaster.writeData(REG_BAUD_RATE, [toIdx]);
        await sleep(50);
        // Lock EEPROM (write 1 to LOCK)
        await broadcaster.writeData(REG_LOCK, [1]);
        await sleep(100);
    } finally {
        port.removeListener('data', onData);
    }
    console.log(`      Broadcast sequence complete.`);

    console.log(`[4/7] Reopening port at ${args.to} baud...`);
    await setPortBaud(port, args.to);
    await sleep(100);

    console.log(`[5/7] Verifying: pinging each servo at ${args.to}...`);
    let post = await pingAll(port, args.to);
    for (const r of post) console.log(`      Servo ${r.id}: ${r.ok ? 'OK at ' + args.to : 'NO REPLY at ' + args.to}`);
    const postOk = post.filter(r => r.ok).length;

    if (postOk === SERVO_IDS.length) {
        console.log(`\n[OK] All ${SERVO_IDS.length} servos responded at ${args.to}.`);
        console.log(`      Next step: edit SERIAL_BAUDRATE in server.js to ${args.to} and restart the service.`);
        await closePort(port);
        process.exit(0);
    }

    // Some servos didn't respond at the new baud. Check if they're stuck at the old baud (broadcast missed).
    console.log(`\n[6/7] ${SERVO_IDS.length - postOk} servo(s) silent at ${args.to}. Checking if they're still at ${args.from}...`);
    await setPortBaud(port, args.from);
    await sleep(100);
    let recheck = await pingAll(port, args.from);
    const stillOld = recheck.filter(r => r.ok).map(r => r.id);
    const trulyMissing = recheck.filter(r => !r.ok).map(r => r.id);

    if (stillOld.length > 0) {
        console.error(`\n[SPLIT BUS] Servos still at ${args.from}: ${stillOld.join(', ')}`);
        console.error(`            Servos now at ${args.to}: ${post.filter(r => r.ok).map(r => r.id).join(', ')}`);
        console.error(`            Re-run the script to push the lagging servos to ${args.to}.`);
        await closePort(port);
        process.exit(3);
    }

    if (trulyMissing.length > 0) {
        console.error(`\n[7/7] Servos silent at BOTH bauds: ${trulyMissing.join(', ')}`);
        console.error(`      Try other common bauds manually:`);
        for (const b of Object.keys(BAUD_INDEX).map(Number)) {
            if (b === args.from || b === args.to) continue;
            await setPortBaud(port, b);
            await sleep(100);
            const r = await pingAll(port, b);
            const found = r.filter(x => x.ok).map(x => x.id);
            if (found.length) console.error(`      At ${b} baud: ${found.join(', ')}`);
        }
        await closePort(port);
        process.exit(4);
    }

    await closePort(port);
    process.exit(0);
}

main().catch((err) => {
    console.error('FATAL:', err && err.stack ? err.stack : err);
    process.exit(99);
});
