// Read every protection-related EEPROM register on each servo so we know
// what's limiting the motors. Run with bridge STOPPED.
//
// ST3215 register map (Feetech STS):
//   0x10 (16): Max Torque Limit       (EEPROM, 0-1000)
//   0x0D (13): Max Temperature Limit  (EEPROM, deg C)
//   0x14 (20): Unloading Condition    (EEPROM, bitfield of which faults disable torque)
//   0x16 (22): Recovery Condition     (EEPROM, mirrors of unload bits for auto-recovery)
//   0x22 (34): Overload Torque        (EEPROM, 0-1000 — protection threshold)
//   0x24 (36): Time For OL Torque     (EEPROM, 0-255 in ~100ms units before protection trips)
//   0x18 (24): P gain   0x19 (25): D gain   0x1A (26): I gain
//   0x1B (27): Min Start Force
//   0x1C (28): CW dead zone   0x1D (29): CCW dead zone

const { SerialPort } = require('serialport');
const RobotArm = require('./robotArmST3215');

const SERVO_IDS = [1, 2, 3, 4, 5, 6];
const BAUD = 500000;
const REGS = [
  { addr: 0x0D, len: 1, name: 'MaxTemp' },
  { addr: 0x0E, len: 1, name: 'MaxV' },
  { addr: 0x0F, len: 1, name: 'MinV' },
  { addr: 0x10, len: 2, name: 'MaxTorqueLimit (EEPROM)' },
  { addr: 0x14, len: 1, name: 'UnloadCondition (bitfield)' },
  { addr: 0x16, len: 1, name: 'RecoveryCondition (bitfield)' },
  { addr: 0x18, len: 1, name: 'P gain' },
  { addr: 0x19, len: 1, name: 'D gain' },
  { addr: 0x1A, len: 1, name: 'I gain' },
  { addr: 0x1B, len: 1, name: 'MinStartForce' },
  { addr: 0x1C, len: 1, name: 'CWDeadZone' },
  { addr: 0x1D, len: 1, name: 'CCWDeadZone' },
  { addr: 0x22, len: 2, name: 'OverloadTorque (protection)' },
  { addr: 0x24, len: 1, name: 'OverloadTime (~100ms units)' },
  { addr: 0x30, len: 2, name: 'GoalTorque (RAM, current goal)' },
];

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
    for (const r of REGS) {
      try {
        const buf = await c.readData(r.addr, r.len);
        let val;
        if (r.len === 1) val = buf[0];
        else val = buf[0] | (buf[1] << 8);
        console.log(`  0x${r.addr.toString(16).padStart(2,'0')} ${r.name.padEnd(34)} = ${val}`);
      } catch (e) {
        console.log(`  0x${r.addr.toString(16).padStart(2,'0')} ${r.name.padEnd(34)} = read failed: ${e.message}`);
      }
      await sleep(40);
    }
    await sleep(80);
  }
  port.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
