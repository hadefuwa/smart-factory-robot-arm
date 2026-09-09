// One-shot read of each servo's RAM goal-torque (48) and EEPROM max-torque
// limit (16). Run with bridge service STOPPED.
const { SerialPort } = require('serialport');
const RobotArm = require('./robotArmST3215');

const SERVO_IDS = [1, 2, 3, 4, 5, 6];
const BAUD = 500000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function openPort() {
    return new Promise((resolve, reject) => {
        const port = new SerialPort({ path: '/dev/ttyACM0', baudRate: BAUD, autoOpen: false });
        port.open((err) => err ? reject(err) : resolve(port));
    });
}

(async () => {
    const port = await openPort();
    const controllers = SERVO_IDS.map(id => new RobotArm.ServoController(id, port, id, BAUD));
    port.on('data', (d) => controllers.forEach(c => c.handleIncomingData(d)));

    for (const c of controllers) {
        try {
            const ramBuf = await c.readData(48, 2);  // RAM Goal Torque (low/high)
            const ramRaw = ramBuf[0] | (ramBuf[1] << 8);
            const eepBuf = await c.readData(16, 2);  // EEPROM Max Torque Limit (low/high)
            const eepRaw = eepBuf[0] | (eepBuf[1] << 8);
            console.log(`Servo ${c.servoIdNumber}: RAM goal-torque=${ramRaw} (${(ramRaw/10).toFixed(1)}%)  EEPROM max-torque=${eepRaw} (${(eepRaw/10).toFixed(1)}%)`);
        } catch (e) {
            console.log(`Servo ${c.servoIdNumber}: read failed — ${e.message}`);
        }
        await sleep(80);
    }
    port.close();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
