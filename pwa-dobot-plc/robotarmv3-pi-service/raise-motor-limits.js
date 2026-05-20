// One-time EEPROM tweak: remove the OVERLOAD + MOTOR auto-unload bits
// and max out the overload-time, so the servos push to their actual
// torque ceiling instead of cutting drive at the first hint of load.
//
// Keeps voltage/sensor/overtemp protection enabled (motor would
// otherwise burn out from undervoltage or runaway heat).
//
// Run with bridge service STOPPED.
//
// Registers touched per servo (all EEPROM):
//   0x14 UnloadCondition: 47 -> 7
//     bits cleared: bit3 (OVERLOAD=8), bit5 (MOTOR=32)
//     bits kept   : bit0 (VOLTAGE=1), bit1 (SENSOR=2), bit2 (TEMP=4)
//   0x24 OverloadTime    : 80 -> 254  (max allowed run-time under overload)
//
// 0x37 LOCK is toggled 0 (unlock) -> writes -> 1 (lock).

const { SerialPort } = require('serialport');
const RobotArm = require('./robotArmST3215');

const SERVO_IDS = [1, 2, 3, 4, 5, 6];
const BAUD = 500000;
const REG_LOCK = 0x37;
const REG_UNLOAD = 0x14;
const REG_OVERLOAD_TIME = 0x24;
const NEW_UNLOAD = 7;
const NEW_OVERLOAD_TIME = 254;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const port = await new Promise((resolve, reject) => {
    const p = new SerialPort({ path: '/dev/ttyACM0', baudRate: BAUD, autoOpen: false });
    p.open((e) => e ? reject(e) : resolve(p));
  });
  const controllers = SERVO_IDS.map(id => new RobotArm.ServoController(id, port, id, BAUD));
  port.on('data', (d) => controllers.forEach(c => c.handleIncomingData(d)));

  for (const c of controllers) {
    console.log(`\n=== Servo ${c.servoIdNumber} ===`);
    try {
      // Snapshot before
      const beforeUnload = (await c.readData(REG_UNLOAD, 1))[0];
      const beforeOT = (await c.readData(REG_OVERLOAD_TIME, 1))[0];
      console.log(`  before: UnloadCondition=${beforeUnload}  OverloadTime=${beforeOT}`);

      // Unlock EEPROM
      await c.writeData(REG_LOCK, [0]);
      await sleep(30);
      // Write new limits
      await c.writeData(REG_UNLOAD, [NEW_UNLOAD]);
      await sleep(30);
      await c.writeData(REG_OVERLOAD_TIME, [NEW_OVERLOAD_TIME]);
      await sleep(30);
      // Lock EEPROM
      await c.writeData(REG_LOCK, [1]);
      await sleep(60);

      // Verify
      const afterUnload = (await c.readData(REG_UNLOAD, 1))[0];
      const afterOT = (await c.readData(REG_OVERLOAD_TIME, 1))[0];
      console.log(`  after : UnloadCondition=${afterUnload}  OverloadTime=${afterOT}`);
      if (afterUnload === NEW_UNLOAD && afterOT === NEW_OVERLOAD_TIME) {
        console.log(`  OK servo ${c.servoIdNumber} updated`);
      } else {
        console.log(`  WARN servo ${c.servoIdNumber} verification mismatch`);
      }
    } catch (e) {
      console.log(`  servo ${c.servoIdNumber} ERROR: ${e.message}`);
    }
    await sleep(120);
  }
  port.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
