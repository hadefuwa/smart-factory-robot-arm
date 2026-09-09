// Read each servo's STS_ACC register (41) to see current acceleration setting
const { SerialPort } = require('serialport');
const RobotArm = require('./robotArmST3215');

const SERVO_IDS = [1, 2, 3, 4, 5, 6];
const BAUD = 500000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    const port = await new Promise((resolve, reject) => {
        const p = new SerialPort({ path: '/dev/ttyACM0', baudRate: BAUD, autoOpen: false });
        p.open((e) => e ? reject(e) : resolve(p));
    });
    const controllers = SERVO_IDS.map(id => new RobotArm.ServoController(id, port, id, BAUD));
    port.on('data', (d) => controllers.forEach(c => c.handleIncomingData(d)));

    for (const c of controllers) {
        try {
            const buf = await c.readData(41, 1);
            const acc = buf[0];
            console.log(`Servo ${c.servoIdNumber}: ACC register = ${acc} (means ${acc * 100} step/s²)`);
        } catch (e) {
            console.log(`Servo ${c.servoIdNumber}: read failed — ${e.message}`);
        }
        await sleep(80);
    }
    port.close();
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
