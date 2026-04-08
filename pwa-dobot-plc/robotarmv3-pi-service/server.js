const WebSocket = require('ws');
const { JointController } = require('./robotArmI2C');

const PORT = Number(process.env.ROBOT_ARM_PORT || 8080);
const I2C_BUS = process.env.ROBOT_ARM_I2C_BUS || '/dev/i2c-1';
const JOINT_ADDRESSES = (process.env.ROBOT_ARM_ADDRESSES || '0x22,0x23')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => Number(item));

const joints = [];
let piSocket = null;

function parseJointIndex(inputJoint) {
  const parsed = Number(inputJoint);
  if (!Number.isInteger(parsed)) return -1;
  return parsed - 1;
}

async function initializeJoints() {
  console.log('Initializing joints...');
  for (let i = 0; i < JOINT_ADDRESSES.length; i += 1) {
    const address = JOINT_ADDRESSES[i];
    const joint = new JointController(i + 1, I2C_BUS, address);
    try {
      await joint.open();
      joints.push(joint);
      console.log(`Joint ${i + 1} ready at address 0x${address.toString(16)}`);
    } catch (error) {
      console.error(`Joint ${i + 1} failed to initialize: ${error.message}`);
      joints.push(null);
    }
  }
}

async function getStatusPayload() {
  const jointStatus = [];
  for (let i = 0; i < joints.length; i += 1) {
    const joint = joints[i];
    if (!joint) {
      jointStatus.push({
        joint: i + 1,
        available: false,
        isMoving: false,
        stallDetected: false,
        angleDegrees: 0,
      });
      continue;
    }
    try {
      const status = await joint.readStatus();
      jointStatus.push({
        joint: i + 1,
        available: true,
        ...status,
      });
    } catch (error) {
      jointStatus.push({
        joint: i + 1,
        available: false,
        error: error.message,
      });
    }
  }
  return { type: 'status', joints: jointStatus };
}

async function handleCommand(ws, data) {
  if (!data || !data.command) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing command' }));
    return;
  }

  if (data.command === 'getStatus') {
    ws.send(JSON.stringify(await getStatusPayload()));
    return;
  }

  if (data.command === 'moveJoint') {
    const index = parseJointIndex(data.joint);
    if (index < 0 || index >= joints.length || !joints[index]) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid or unavailable joint' }));
      return;
    }
    await joints[index].moveToAngle(data.angle);
    ws.send(JSON.stringify({ type: 'success', message: `Joint ${data.joint} moving` }));
    return;
  }

  if (data.command === 'stopJoint') {
    const index = parseJointIndex(data.joint);
    if (index < 0 || index >= joints.length || !joints[index]) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid or unavailable joint' }));
      return;
    }
    await joints[index].stopMotion();
    ws.send(JSON.stringify({ type: 'success', message: `Joint ${data.joint} stopped` }));
    return;
  }

  if (data.command === 'stopAll') {
    for (let i = 0; i < joints.length; i += 1) {
      if (joints[i]) {
        try {
          await joints[i].stopMotion();
        } catch (error) {
          console.error(`Failed to stop joint ${i + 1}: ${error.message}`);
        }
      }
    }
    ws.send(JSON.stringify({ type: 'success', message: 'All joints stop command sent' }));
    return;
  }

  ws.send(JSON.stringify({ type: 'error', message: `Unknown command: ${data.command}` }));
}

async function cleanupAndExit() {
  console.log('\nShutting down robot arm Pi service...');
  for (let i = 0; i < joints.length; i += 1) {
    if (joints[i]) {
      try {
        await joints[i].close();
      } catch (error) {
        console.error(`Error closing joint ${i + 1}: ${error.message}`);
      }
    }
  }
  if (piSocket) {
    piSocket.close();
  }
  process.exit(0);
}

async function startServer() {
  await initializeJoints();

  piSocket = new WebSocket.Server({ port: PORT });
  console.log(`Robot arm Pi service listening on ws://0.0.0.0:${PORT}`);
  console.log(`I2C bus: ${I2C_BUS}`);
  console.log(`Joint addresses: ${JOINT_ADDRESSES.map((n) => `0x${n.toString(16)}`).join(', ')}`);

  piSocket.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected', message: 'Pi robot service connected' }));

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(String(message));
        await handleCommand(ws, data);
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
      }
    });
  });
}

process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);

startServer().catch((error) => {
  console.error('Failed to start Pi service:', error);
  process.exit(1);
});
