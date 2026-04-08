const { JointController } = require('./robotArmI2C');

const I2C_BUS = process.env.ROBOT_ARM_I2C_BUS || '/dev/i2c-1';
const FIRST_ADDRESS = Number((process.env.ROBOT_ARM_ADDRESSES || '0x22').split(',')[0].trim());

async function run() {
  const joint = new JointController(1, I2C_BUS, FIRST_ADDRESS);
  try {
    console.log('Opening I2C connection...');
    await joint.open();
    console.log('Reading status...');
    const status = await joint.readStatus();
    console.log('Status:', status);
    console.log('Done.');
  } catch (error) {
    console.error('I2C test failed:', error.message);
  } finally {
    await joint.close();
  }
}

run();
