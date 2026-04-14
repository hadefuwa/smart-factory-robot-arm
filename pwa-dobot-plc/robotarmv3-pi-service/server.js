/**
 * Robot Arm WebSocket Server (ST3215 Version)
 * 
 * This server runs on the Raspberry Pi and connects the Electron desktop app
 * to the ST3215 serial bus servo motors. It receives commands from the Electron app
 * and translates them to serial commands for the ST3215 servos.
 * 
 * Usage:
 *   node server.js
 * 
 * This server listens on port 8080 by default and communicates with:
 * - Electron desktop app (via WebSocket)
 * - ST3215 servos (via Serial/UART)
 */

const WebSocket = require('ws');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const RobotArm = require('./robotArmST3215');
const { parseURDF } = require('./urdfParser');
const { RobotKinematics } = require('./kinematics');

// Configuration
const PORT = parseInt(process.env.ROBOT_ARM_PORT || "8080");
const JOINT_COUNT = 6; // Number of robot arm joints (ST3215 servos)
const SERIAL_PORT = '/dev/ttyACM0'; // ST3215 driver board (CDC-ACM device)
const SERIAL_BAUDRATE = 1000000; // ST3215 bus baud rate for this Pi setup

// Debug flag - set to true to enable verbose debug messages
let DEBUG = false;
// Simple performance logging flag (set to true to see timing info)
const PERF_DEBUG = false;

// Inverse kinematics — loaded once at startup from the URDF alongside this file
const robotKinematics = new RobotKinematics();
try {
    const urdfPath = path.join(__dirname, 'demo-kinematics.urdf');
    const urdfXml = fs.readFileSync(urdfPath, 'utf8');
    robotKinematics.loadURDF(urdfXml);
    console.log('Kinematics: URDF loaded successfully');
} catch (err) {
    console.error('Kinematics: Failed to load URDF —', err.message);
}


// In-memory log ring buffer for debug endpoint
const LOG_RING = [];
const LOG_RING_MAX = 100;
function logRing(level, msg) {
    LOG_RING.push({ t: Date.now(), level, msg });
    if (LOG_RING.length > LOG_RING_MAX) LOG_RING.shift();
}
const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);
console.log   = (...a) => { const s = a.join(' '); logRing('info',  s); _origLog(s);   };
console.warn  = (...a) => { const s = a.join(' '); logRing('warn',  s); _origWarn(s);  };
console.error = (...a) => { const s = a.join(' '); logRing('error', s); _origError(s); };

// Array to store servo controllers
const servos = [];

/**
 * Shared serial port instance (all servos use the same port)
 */
let sharedSerialPort = null;

/**
 * Array to store all servo controllers for data routing
 * This is used by the shared serial port data handler
 */
let allServoControllers = [];

/**
 * Write queue for serializing writes to the shared serial port
 * This ensures only one write happens at a time
 */
let writeQueue = [];
let isWriting = false;

/**
 * Global command queue for serializing ALL commands across all clients and servos
 * This ensures only one command is processed at a time, preventing conflicts
 */
let commandQueue = [];
let isProcessingCommand = false;
const MAX_COMMAND_QUEUE_SIZE = 100; // Maximum queue size (status polls + moves)
const commandStats = {
    totalProcessed: 0,
    maxQueueLengthSeen: 0,
    byType: {}
};

function ensureCommandStat(type) {
    const key = type || 'unknown';
    if (!commandStats.byType[key]) {
        commandStats.byType[key] = {
            count: 0,
            avgWaitMs: 0,
            maxWaitMs: 0,
            avgExecMs: 0,
            maxExecMs: 0
        };
    }
    return commandStats.byType[key];
}

/**
 * Queue a write operation to the shared serial port
 * @param {Function} writeFn - Function that performs the write
 * @returns {Promise} Promise that resolves when write completes
 */
async function queueWrite(writeFn) {
    return new Promise((resolve, reject) => {
        writeQueue.push({ writeFn, resolve, reject });
        processWriteQueue();
    });
}

/**
 * Process the write queue (one write at a time)
 */
async function processWriteQueue() {
    if (isWriting || writeQueue.length === 0) {
        return;
    }
    
    isWriting = true;
    const { writeFn, resolve, reject } = writeQueue.shift();
    
    try {
        await writeFn();
        resolve();
    } catch (error) {
        reject(error);
    } finally {
        isWriting = false;
        // Process next item in queue
        processWriteQueue();
    }
}

/**
 * Queue a command to be processed (ensures only one command at a time across all clients)
 * @param {Function} commandFn - Function that executes the command
 * @returns {Promise} Promise that resolves when command completes
 */
async function queueCommand(commandFn, meta) {
    return new Promise((resolve, reject) => {
        // Prevent queue from growing too large (could indicate a problem)
        if (commandQueue.length >= MAX_COMMAND_QUEUE_SIZE) {
            console.warn(`Command queue full (${commandQueue.length} items), rejecting new command`);
            reject(new Error('Command queue is full, server may be overloaded'));
            return;
        }
        const commandType = (meta && meta.type) ? String(meta.type) : 'unknown';
        commandQueue.push({ commandFn, resolve, reject, enqueuedAt: Date.now(), commandType });
        if (commandQueue.length > commandStats.maxQueueLengthSeen) {
            commandStats.maxQueueLengthSeen = commandQueue.length;
        }
        processCommandQueue();
    });
}

/**
 * Process the command queue (one command at a time)
 */
async function processCommandQueue() {
    if (isProcessingCommand || commandQueue.length === 0) {
        return;
    }
    
    isProcessingCommand = true;
    const { commandFn, resolve, reject, enqueuedAt, commandType } = commandQueue.shift();
    
    try {
        const waitMs = Math.max(0, Date.now() - (enqueuedAt || Date.now()));
        const startedAt = Date.now();
        await maybeReopenPort();
        const result = await commandFn();
        const execMs = Math.max(0, Date.now() - startedAt);
        const stat = ensureCommandStat(commandType);
        stat.count += 1;
        stat.avgWaitMs = ((stat.avgWaitMs * (stat.count - 1)) + waitMs) / stat.count;
        stat.avgExecMs = ((stat.avgExecMs * (stat.count - 1)) + execMs) / stat.count;
        if (waitMs > stat.maxWaitMs) stat.maxWaitMs = waitMs;
        if (execMs > stat.maxExecMs) stat.maxExecMs = execMs;
        commandStats.totalProcessed += 1;
        // Reduced delay after command completes - only 5ms instead of 10ms
        // This helps prevent response conflicts while reducing accumulated lag
        await new Promise(resolve => setTimeout(resolve, 5));
        resolve(result);
    } catch (error) {
        reject(error);
    } finally {
        isProcessingCommand = false;
        // Process next command in queue
        processCommandQueue();
    }
}

/**
 * Initialize all servo controllers
 */
async function initializeServos() {
    console.log('Initializing ST3215 servo controllers...');
    
    // ST3215 servo IDs (1-6 for 6 servos)
    // Each servo must have a unique ID configured
    const servoIds = [1, 2, 3, 4, 5, 6];
    
    if (servoIds.length < JOINT_COUNT) {
        console.error(`Error: Need ${JOINT_COUNT} servo IDs but only ${servoIds.length} provided`);
        console.error('Please configure more servo IDs in the servoIds array');
        process.exit(1);
    }
    
    // Create a single shared serial port for all servos (they're daisy-chained)
    const { SerialPort } = require('serialport');
    
    try {
        console.log('Opening shared serial port...');
        sharedSerialPort = new SerialPort({
            path: SERIAL_PORT,
            baudRate: SERIAL_BAUDRATE,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            autoOpen: false
        });
        
        // Open the shared port
        await new Promise((resolve, reject) => {
            sharedSerialPort.open((error) => {
                if (error) {
                    console.error('Failed to open shared serial port:', error.message);
                    reject(error);
                } else {
                    console.log('✓ Shared serial port opened successfully');
                    resolve();
                }
            });
        });
        
        // Handle incoming data from all servos
        // We'll set up a single data handler that routes to all servo controllers
        sharedSerialPort.on('data', (data) => {
            console.log('[RAW DATA]', data.toString('hex'), 'len=' + data.length, 'controllers=' + allServoControllers.length + ' waiting=' + allServoControllers.filter(s=>s&&s.responseResolve).map(s=>s.servoIdNumber).join(','));
            // Route data to all servo controllers - they'll filter by ID
            allServoControllers.forEach(servo => {
                if (servo && servo.handleIncomingData) {
                    servo.handleIncomingData(data);
                }
            });
        });
        
        sharedSerialPort.on('error', (error) => {
            console.error('Shared serial port error:', error.message);
        });
        
        // Attach write queue function to shared port for servo controllers to use
        sharedSerialPort._writeQueue = queueWrite;
        
    } catch (error) {
        console.error('Failed to initialize shared serial port:', error.message);
        process.exit(1);
    }
    
    // Create servo controllers, all sharing the same serial port
    for (let i = 0; i < JOINT_COUNT; i++) {
        // Pass the shared SerialPort instance instead of the path
        const servo = new RobotArm.ServoController(i + 1, sharedSerialPort, servoIds[i], SERIAL_BAUDRATE);
        
        try {
            // This will set up the data handler but won't try to open the port
            await servo.open();
            
            // Add servo to the list for data routing
            allServoControllers.push(servo);
            
            // Add a delay between servo initializations to avoid simultaneous writes
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            
            // First, try to ping the servo to verify communication
            console.log(`Pinging servo ${i + 1} (ST3215 ID: ${servoIds[i]})...`);
            const pingResult = await servo.ping();
            if (!pingResult) {
                console.log(`⚠️  Servo ${i + 1} (ID: ${servoIds[i]}) did not respond to ping - skipping`);
                servos.push(null);
                continue;
            }
            console.log(`✓ Servo ${i + 1} (ID: ${servoIds[i]}) responded to ping`);
            
            // Small delay after ping
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // NOTE: torque is NOT enabled at init - avoids power-sag when multiple
            // servos hold position simultaneously.  Torque is enabled on first move.
            servos.push(servo);
            console.log(`Servo ${i + 1} initialized (ST3215 ID: ${servoIds[i]})`);
        } catch (error) {
            console.error(`Failed to initialize servo ${i + 1} (ST3215 ID: ${servoIds[i]}):`, error.message);
            // Create a placeholder so the array stays aligned
            servos.push(null);
        }
    }
    
    console.log(`Initialized ${servos.filter(s => s !== null).length} of ${JOINT_COUNT} servos`);
}

/**
 * Get status from all servos
 * 
 * IMPORTANT: Read servos one-by-one on the shared serial bus.
 * This is simpler and more reliable than doing all reads in parallel.
 */
async function getAllServoStatus() {
    const statuses = [];
    const startAll = Date.now();

    for (let i = 0; i < servos.length; i++) {
        const servo = servos[i];

        if (servo === null) {
            // Servo not available - push default status
            statuses.push({
                joint: i + 1,
                available: false,
                isMoving: false,
                angleDegrees: 0,
                position: 0,
                stepPosition: 0,
                speed: 0,
                load: 0,
                voltage: 0,
                temperature: 0,
                torqueEnabled: false
            });
            continue;
        }

        const startServo = Date.now();
        try {
            // Fast path: one bulk read per servo (angle, speed, load, voltage, temp, moving, torque)
            const status = await servo.readQuickStatus();
            statuses.push({
                joint: i + 1,
                available: true,
                ...status,
                stepPosition: status.position
            });
        } catch (error) {
            console.error(`Error reading status from servo ${i + 1}:`, error.message);
            statuses.push({
                joint: i + 1,
                available: false,
                isMoving: false,
                angleDegrees: 0,
                position: 0,
                stepPosition: 0,
                speed: 0,
                load: 0,
                voltage: 0,
                temperature: 0,
                torqueEnabled: false,
                error: error.message
            });
        }

        const servoDuration = Date.now() - startServo;
        if (PERF_DEBUG && servoDuration > 50) {
            console.log(`PERF: readStatus for servo ${i + 1} took ${servoDuration} ms`);
        }
    }

    const totalDuration = Date.now() - startAll;
    if (PERF_DEBUG) {
        console.log(`PERF: getAllServoStatus for ${servos.length} servos took ${totalDuration} ms`);
    }

    // Already in joint order
    return statuses;
}

/**
 * Start the WebSocket server
 */
function startServer() {
    console.log(`Starting WebSocket server on port ${PORT}...`);
    
    // Create WebSocket server
    const wss = new WebSocket.Server({ port: PORT });
    
    console.log(`Server listening on port ${PORT}`);
    console.log('Waiting for clients to connect...');
    
    // Handle new client connections
    wss.on('connection', function connection(ws, req) {
        const clientIp = req.socket.remoteAddress;
        console.log(`Client connected from ${clientIp}`);
        
        // Send welcome message
        ws.send(JSON.stringify({
            type: 'connected',
            message: 'Connected to Robot Arm Server (ST3215)'
        }));
        
        // Handle incoming messages from client
        ws.on('message', async function incoming(message) {
            try {
                const data = JSON.parse(message);
                // Queue the command to ensure only one command is processed at a time
                await queueCommand(async () => {
                    await handleCommand(ws, data);
                }, { type: data && data.command ? data.command : 'unknown' });
            } catch (error) {
                console.error('Error handling message:', error);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: error.message
                }));
            }
        });
        
        // Handle client disconnect
        ws.on('close', function() {
            console.log(`Client disconnected from ${clientIp}`);
        });
        
        // Handle errors
        ws.on('error', function(error) {
            console.error('WebSocket error:', error);
        });
    });
}

/**
 * Handle commands from the Electron app
 */
async function handleCommand(ws, data) {
    const command = data.command;
    
    // Handle different commands
    switch (command) {
        case 'getPiNetworkInfo': {
            // Return basic network information for display in the Electron app
            try {
                const hostname = os.hostname();
                const interfaces = os.networkInterfaces() || {};

                // Collect a simple list of IPv4 addresses with MACs
                const ifaceSummaries = [];
                Object.keys(interfaces).forEach((name) => {
                    (interfaces[name] || []).forEach((info) => {
                        if (info && info.family === 'IPv4' && !info.internal) {
                            ifaceSummaries.push({
                                name: name,
                                address: info.address,
                                mac: info.mac || null
                            });
                        }
                    });
                });

                // Try to read default gateway from /proc/net/route (Linux-specific)
                let gateway = null;
                try {
                    const routeText = fs.readFileSync('/proc/net/route', 'utf8');
                    const lines = routeText.trim().split('\n');
                    // Skip header line
                    for (let i = 1; i < lines.length; i++) {
                        const parts = lines[i].trim().split(/\s+/);
                        if (parts.length >= 3) {
                            const dest = parts[1];
                            const gwHex = parts[2];
                            const flags = parseInt(parts[3] || '0', 16);
                            // Destination 00000000 and flag 0x2 means default route
                            if (dest === '00000000' && (flags & 0x2)) {
                                const gwNum = parseInt(gwHex, 16);
                                const b1 = gwNum & 0xFF;
                                const b2 = (gwNum >> 8) & 0xFF;
                                const b3 = (gwNum >> 16) & 0xFF;
                                const b4 = (gwNum >> 24) & 0xFF;
                                gateway = `${b1}.${b2}.${b3}.${b4}`;
                                break;
                            }
                        }
                    }
                } catch (e) {
                    // If we cannot read the route table, just leave gateway as null
                    if (DEBUG) {
                        console.warn('getPiNetworkInfo: could not read /proc/net/route:', e.message || e);
                    }
                }

                ws.send(JSON.stringify({
                    type: 'networkInfo',
                    hostname: hostname,
                    interfaces: ifaceSummaries,
                    gateway: gateway
                }));
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Failed to read network info: ' + (error.message || error)
                }));
            }
            break;
        }

        case 'updatePiServerFromGit': {
            // Run "git pull --ff-only" in this folder (raspberry-pi-control-st3215)
            exec('git pull --ff-only', { cwd: __dirname }, (error, stdout, stderr) => {
                if (error) {
                    console.error('updatePiServerFromGit error:', error);
                    ws.send(JSON.stringify({
                        type: 'updateResult',
                        ok: false,
                        target: 'st3215',
                        message: `git pull failed: ${stderr || error.message}`
                    }));
                } else {
                    console.log('updatePiServerFromGit output:', stdout);
                    ws.send(JSON.stringify({
                        type: 'updateResult',
                        ok: true,
                        target: 'st3215',
                        message: stdout.trim()
                    }));

                    // Restart Node.js so the updated code is loaded.
                    // systemd is configured with Restart=always, so exiting here is enough.
                    setTimeout(function () {
                        try {
                            process.exit(0);
                        } catch (e) {
                            // If exit fails for some reason, we just do nothing.
                        }
                    }, 500);
                }
            });
            break;
        }
        case 'getJointConfigs':
            // Return the number of servos discovered and their basic configuration
            const discoveredServos = servos.filter(s => s !== null).length;
            const jointConfigs = [];
            
            // Create config for each discovered servo
            for (let i = 0; i < servos.length; i++) {
                if (servos[i] !== null) {
                    jointConfigs.push({
                        jointNumber: i + 1,
                        servoId: servos[i].servoIdNumber,
                        available: true
                    });
                }
            }
            
            ws.send(JSON.stringify({
                type: 'jointConfigs',
                count: discoveredServos,
                total: servos.length,
                joints: jointConfigs
            }));
            break;
            
        case 'getStatus': {
            // Send status of all servos, plus current XYZ position from FK
            const statuses = await getAllServoStatus();
            let currentXYZ = null;
            if (robotKinematics.isConfigured()) {
                try {
                    const availableAngles = statuses
                        .filter(s => s.available)
                        .map(s => s.angleDegrees);
                    // Only compute FK if we have angles for all revolute joints
                    if (availableAngles.length === robotKinematics.getJointCount()) {
                        const fk = robotKinematics.forwardKinematics(availableAngles);
                        if (fk && fk.position) {
                            currentXYZ = {
                                x: Math.round(fk.position.x * 10) / 10,
                                y: Math.round(fk.position.y * 10) / 10,
                                z: Math.round(fk.position.z * 10) / 10
                            };
                        }
                    }
                } catch (_) {}
            }
            ws.send(JSON.stringify({
                type: 'status',
                joints: statuses,
                currentXYZ: currentXYZ
            }));
            break;
        }
            
        case 'moveJoint':
            // Move a servo to a specific angle
            const jointNumber = data.joint - 1; // Convert to 0-based index
            const angle = data.angle;
            // Ensure speed is a valid number (default to 1500 if not provided or invalid)
            const moveSpeed = (typeof data.speed === 'number' && !isNaN(data.speed) && data.speed >= 0) ? data.speed : 1500;
            
            if (jointNumber < 0 || jointNumber >= servos.length) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Invalid joint number: ${data.joint}`
                }));
                return;
            }
            
            const servo = servos[jointNumber];
            if (servo === null) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Servo ${data.joint} is not available`
                }));
                return;
            }
            
            try {
                await servo.moveToAngle(angle, moveSpeed);
                ws.send(JSON.stringify({
                    type: 'success',
                    message: `Servo ${data.joint} moving to ${angle}° at ${moveSpeed} step/s`
                }));
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Failed to move servo ${data.joint}: ${error.message}`
                }));
            }
            break;
            
        case 'holdAllJoints': {
            // Read current position from each servo and write it back as goal, then enable torque.
            // This locks joints in place without snapping to a previously commanded angle.
            const holdResults = [];
            for (let hi = 0; hi < servos.length; hi++) {
                if (servos[hi] !== null) {
                    const ok = await servos[hi].holdCurrentPosition();
                    holdResults.push({ joint: hi + 1, held: ok });
                }
            }
            ws.send(JSON.stringify({ type: 'success', message: 'Holding all joints at current position', results: holdResults }));
            break;
        }

        case 'holdJoint': {
            // Hold one specific joint at its current physical position.
            const holdJointIdx = (data.joint || 1) - 1;
            if (holdJointIdx < 0 || holdJointIdx >= servos.length || servos[holdJointIdx] === null) {
                ws.send(JSON.stringify({ type: 'error', message: 'Joint not available: ' + data.joint }));
                break;
            }
            const held = await servos[holdJointIdx].holdCurrentPosition();
            ws.send(JSON.stringify({ type: held ? 'success' : 'error', message: held ? ('Joint ' + data.joint + ' holding') : ('Failed to hold joint ' + data.joint) }));
            break;
        }

        case 'stopJoint':
            // Stop a specific servo
            const stopJointNumber = data.joint - 1;
            
            if (stopJointNumber < 0 || stopJointNumber >= servos.length) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Invalid joint number: ${data.joint}`
                }));
                return;
            }
            
            const stopServo = servos[stopJointNumber];
            if (stopServo === null) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Servo ${data.joint} is not available`
                }));
                return;
            }
            
            try {
                await stopServo.stopServo();
                ws.send(JSON.stringify({
                    type: 'success',
                    message: `Servo ${data.joint} stopped`
                }));
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Failed to stop servo ${data.joint}: ${error.message}`
                }));
            }
            break;
            
        case 'stopAllJoints':
            // Stop all servos
            try {
                for (let i = 0; i < servos.length; i++) {
                    if (servos[i] !== null) {
                        await servos[i].stopServo();
                    }
                }
                ws.send(JSON.stringify({
                    type: 'success',
                    message: 'All servos stopped'
                }));
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Failed to stop all servos: ${error.message}`
                }));
            }
            break;
            
        case 'setServoAngle':
            // Set servo angle (for gripper or other servo-controlled joints)
            const servoJointNumber = data.joint - 1;
            const servoAngle = data.angle;
            
            if (servoJointNumber < 0 || servoJointNumber >= servos.length) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Invalid joint number: ${data.joint}`
                }));
                return;
            }
            
            const servoJoint = servos[servoJointNumber];
            if (servoJoint === null) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Servo ${data.joint} is not available`
                }));
                return;
            }
            
            try {
                await servoJoint.moveToAngle(servoAngle);
                ws.send(JSON.stringify({
                    type: 'success',
                    message: `Servo ${data.joint} set to ${servoAngle}°`
                }));
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Failed to set servo angle: ${error.message}`
                }));
            }
            break;
            
        case 'setSpeed':
            // Set servo speed
            const speedJointNumber = data.joint - 1;
            const speed = data.speed;
            
            if (speedJointNumber < 0 || speedJointNumber >= servos.length) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Invalid joint number: ${data.joint}`
                }));
                return;
            }
            
            const speedServo = servos[speedJointNumber];
            if (speedServo === null) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Servo ${data.joint} is not available`
                }));
                return;
            }
            
            try {
                await speedServo.setSpeed(speed);
                ws.send(JSON.stringify({
                    type: 'success',
                    message: `Servo ${data.joint} speed set to ${speed} step/s`
                }));
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Failed to set speed: ${error.message}`
                }));
            }
            break;
            
        case 'setSpeedAll':
            // Set servo speed for all joints
            const speedAll = data.speed;
            
            try {
                for (let i = 0; i < servos.length; i++) {
                    if (servos[i] !== null) {
                        await servos[i].setSpeed(speedAll);
                    }
                }
                ws.send(JSON.stringify({
                    type: 'success',
                    message: `All servos speed set to ${speedAll} step/s`
                }));
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Failed to set servo speeds: ${error.message}`
                }));
            }
            break;
            
        case 'setTorqueAll':
            // Enable or disable torque for all joints
            const torqueEnabled = data.enabled !== false; // Default to true if not specified
            
            try {
                for (let i = 0; i < servos.length; i++) {
                    if (servos[i] !== null) {
                        if (torqueEnabled) {
                            await servos[i].startServo();
                        } else {
                            await servos[i].stopServo();
                        }
                    }
                }
                ws.send(JSON.stringify({
                    type: 'success',
                    message: `All servos torque ${torqueEnabled ? 'enabled' : 'disabled'}`
                }));
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Failed to ${torqueEnabled ? 'enable' : 'disable'} torque: ${error.message}`
                }));
            }
            break;
            
        case 'setAcceleration':
            // Set servo acceleration
            const accJointNumber = data.joint - 1;
            const acc = data.acceleration;
            
            if (accJointNumber < 0 || accJointNumber >= servos.length) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Invalid joint number: ${data.joint}`
                }));
                return;
            }
            
            const accServo = servos[accJointNumber];
            if (accServo === null) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Servo ${data.joint} is not available`
                }));
                return;
            }
            
            try {
                await accServo.setAcceleration(acc);
                ws.send(JSON.stringify({
                    type: 'success',
                    message: `Servo ${data.joint} acceleration set to ${acc}`
                }));
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Failed to set acceleration: ${error.message}`
                }));
            }
            break;
            
        case 'scanServos': {
            // Sweep servo IDs to discover which ones are present on the bus.
            const scanMaxId   = Math.min(data.maxId   || 20,  253);
            const scanBauds   = data.baudRates || [SERIAL_BAUDRATE];
            const scanTimeout = Math.min(data.timeout || 100, 500);
            const scanResults = [];

            for (const baud of scanBauds) {
                if (baud !== sharedSerialPort.settings.baudRate) {
                    console.log(`scanServos: reopening port at ${baud} baud`);
                    await new Promise((res) => sharedSerialPort.update({ baudRate: baud }, res));
                    await new Promise((res) => setTimeout(res, 50));
                }

                const foundIds = [];
                for (let id = 1; id <= scanMaxId; id++) {
                    const tempServo = new RobotArm.ServoController(id, sharedSerialPort, id, baud);
                    allServoControllers.push(tempServo);

                    const responded = await new Promise((resolve) => {
                        tempServo.responseResolve = null;
                        tempServo.pendingResponse = null;
                        if (tempServo.responseTimeout) {
                            clearTimeout(tempServo.responseTimeout);
                            tempServo.responseTimeout = null;
                        }
                        tempServo.responseResolve = (result) => {
                            if (tempServo.responseTimeout) {
                                clearTimeout(tempServo.responseTimeout);
                                tempServo.responseTimeout = null;
                            }
                            const ok = result.id === id && result.error === 0;
                            tempServo.responseResolve = null;
                            tempServo.pendingResponse = null;
                            resolve(ok);
                        };
                        tempServo.responseTimeout = setTimeout(() => {
                            tempServo.responseResolve = null;
                            tempServo.pendingResponse = null;
                            resolve(false);
                        }, scanTimeout);
                        tempServo.sendPacket(1, []).catch(() => resolve(false));
                    });

                    const idx = allServoControllers.indexOf(tempServo);
                    if (idx >= 0) allServoControllers.splice(idx, 1);

                    if (responded) {
                        foundIds.push(id);
                        console.log(`scanServos: found servo ID ${id} at ${baud} baud`);
                    }
                }

                if (foundIds.length > 0) {
                    scanResults.push({ baudRate: baud, ids: foundIds });
                }
            }

            if (sharedSerialPort.settings.baudRate !== SERIAL_BAUDRATE) {
                await new Promise((res) => sharedSerialPort.update({ baudRate: SERIAL_BAUDRATE }, res));
                console.log(`scanServos: restored baud rate to ${SERIAL_BAUDRATE}`);
            }

            ws.send(JSON.stringify({
                type: 'scanResult',
                results: scanResults,
                scannedIds: scanMaxId,
                baudRatesChecked: scanBauds,
                summary: scanResults.length > 0
                    ? scanResults.map(r => `IDs [${r.ids.join(',')}] at ${r.baudRate} baud`).join('; ')
                    : `No servos found on IDs 1-${scanMaxId}`
            }));
            break;
        }

        case 'rawWrite': {
            // Direct write to serial port, collect response for up to 200ms
            const hexStr = data.hex || 'ffff010201fb';
            const buf = Buffer.from(hexStr, 'hex');
            const rxChunks = [];
            const collector = (d) => { rxChunks.push(d.toString('hex')); };
            sharedSerialPort.on('data', collector);
            await new Promise((res, rej) => sharedSerialPort.write(buf, (e) => e ? rej(e) : res()));
            await new Promise(res => setTimeout(res, 200));
            sharedSerialPort.removeListener('data', collector);
            ws.send(JSON.stringify({
                type: 'rawWriteResult',
                sent: hexStr,
                received: rxChunks,
                receivedHex: rxChunks.join('')
            }));
            break;
        }

        case 'echo': {
            ws.send(JSON.stringify({
                type: 'echo',
                ts: Date.now(),
                uptime: process.uptime(),
                serialPort: SERIAL_PORT,
                baudRate: SERIAL_BAUDRATE,
                portOpen: sharedSerialPort ? sharedSerialPort.isOpen : false,
                servoCount: servos.filter(s => s !== null).length,
                debugEnabled: DEBUG
            }));
            break;
        }

        case 'getPortInfo': {
            const { SerialPort } = require('serialport');
            let ports = [];
            try { ports = await SerialPort.list(); } catch(e) {}
            ws.send(JSON.stringify({
                type: 'portInfo',
                configuredPort: SERIAL_PORT,
                configuredBaud: SERIAL_BAUDRATE,
                portOpen: sharedSerialPort ? sharedSerialPort.isOpen : false,
                availablePorts: ports.map(p => ({
                    path: p.path,
                    manufacturer: p.manufacturer || null,
                    serialNumber: p.serialNumber || null,
                    vendorId: p.vendorId || null,
                    productId: p.productId || null
                }))
            }));
            break;
        }

        case 'rawPing': {
            const pingId = parseInt(data.id) || 1;
            if (pingId < 1 || pingId > 253) {
                ws.send(JSON.stringify({ type: 'error', message: 'id must be 1-253' }));
                break;
            }
            const tempServo = new RobotArm.ServoController(pingId, sharedSerialPort, pingId, SERIAL_BAUDRATE);
            allServoControllers.push(tempServo);
            const rawResult = await new Promise((resolve) => {
                tempServo.responseResolve = null;
                tempServo.pendingResponse = null;
                if (tempServo.responseTimeout) { clearTimeout(tempServo.responseTimeout); tempServo.responseTimeout = null; }
                tempServo.responseResolve = (result) => {
                    if (tempServo.responseTimeout) { clearTimeout(tempServo.responseTimeout); tempServo.responseTimeout = null; }
                    tempServo.responseResolve = null;
                    tempServo.pendingResponse = null;
                    resolve(result);
                };
                tempServo.responseTimeout = setTimeout(() => {
                    tempServo.responseResolve = null;
                    tempServo.pendingResponse = null;
                    resolve(null);
                }, 300);
                tempServo.sendPacket(1, []).catch(() => resolve(null));
            });
            const idx = allServoControllers.indexOf(tempServo);
            if (idx >= 0) allServoControllers.splice(idx, 1);
            ws.send(JSON.stringify({
                type: 'rawPingResult',
                servoId: pingId,
                responded: rawResult !== null,
                responseId: rawResult ? rawResult.id : null,
                errorByte: rawResult ? rawResult.error : null,
                params: rawResult ? (rawResult.params || []) : []
            }));
            break;
        }

        case 'readRegister': {
            const regId     = parseInt(data.id)       || 1;
            const regAddr   = parseInt(data.register)  || 56;
            const regLen    = Math.min(parseInt(data.length) || 2, 32);
            const regServo  = servos.find(s => s && s.servoIdNumber === regId)
                           || new RobotArm.ServoController(regId, sharedSerialPort, regId, SERIAL_BAUDRATE);
            const isTemp = !servos.find(s => s && s.servoIdNumber === regId);
            if (isTemp) allServoControllers.push(regServo);
            let regResult = null;
            try {
                regResult = await regServo.readData(regAddr, regLen);
            } catch(e) {
                regResult = null;
            }
            if (isTemp) {
                const i2 = allServoControllers.indexOf(regServo);
                if (i2 >= 0) allServoControllers.splice(i2, 1);
            }
            ws.send(JSON.stringify({
                type: 'registerResult',
                servoId: regId,
                register: regAddr,
                length: regLen,
                hex: regResult ? Buffer.from(regResult).toString('hex') : null,
                bytes: regResult ? Array.from(regResult) : null,
                success: regResult !== null
            }));
            break;
        }

        case 'homeAll': {
            const homeResults = [];
            for (let i = 0; i < servos.length; i++) {
                if (servos[i]) {
                    try {
                        await servos[i].moveToAngle(0, 800);
                        homeResults.push({ joint: i+1, ok: true });
                    } catch(e) {
                        homeResults.push({ joint: i+1, ok: false, error: e.message });
                    }
                } else {
                    homeResults.push({ joint: i+1, ok: false, error: 'not available' });
                }
            }
            ws.send(JSON.stringify({ type: 'homeResult', joints: homeResults }));
            break;
        }

        case 'setDebug': {
            DEBUG = data.enabled !== false;
            ws.send(JSON.stringify({ type: 'debugSet', enabled: DEBUG }));
            break;
        }

        case 'getLogs': {
            const count = Math.min(data.count || 50, LOG_RING_MAX);
            ws.send(JSON.stringify({ type: 'logs', entries: LOG_RING.slice(-count) }));
            break;
        }

        case 'getPerfStats': {
            const summary = {
                totalProcessed: commandStats.totalProcessed,
                queueLength: commandQueue.length,
                maxQueueLengthSeen: commandStats.maxQueueLengthSeen,
                byType: commandStats.byType
            };
            ws.send(JSON.stringify({ type: 'perfStats', summary: summary }));
            break;
        }

        case 'moveToXYZ': {
            // Compute IK from target XYZ then issue moveJoint for each joint.
            // Body: { command: "moveToXYZ", x, y, z, speed?: number, orientation?: {x,y,z} }
            const { x: mX, y: mY, z: mZ, speed: mSpeed, orientation: mOri } = data;
            if (mX === undefined || mY === undefined || mZ === undefined) {
                ws.send(JSON.stringify({ type: 'error', message: 'moveToXYZ: x, y, z required' }));
                break;
            }
            if (!robotKinematics.isConfigured()) {
                ws.send(JSON.stringify({ type: 'error', message: 'moveToXYZ: URDF not loaded' }));
                break;
            }
            // Seed the IK solver with the robot's current joint angles so it converges
            // to the nearest solution rather than jumping to an opposite configuration.
            let xyzInitialAngles = null;
            try {
                const xyzStatuses = await getAllServoStatus();
                const xyzCurrentAngles = xyzStatuses.filter(s => s.available).map(s => s.angleDegrees);
                if (xyzCurrentAngles.length === robotKinematics.getJointCount()) {
                    xyzInitialAngles = xyzCurrentAngles;
                }
            } catch (e) { /* fall back to null seed */ }
            const xyzPose = { x: Number(mX), y: Number(mY), z: Number(mZ) };
            if (mOri) xyzPose.orientation = mOri;
            const xyzAngles = robotKinematics.inverseKinematics(xyzPose, xyzInitialAngles);
            if (!xyzAngles) {
                ws.send(JSON.stringify({ type: 'error', message: 'moveToXYZ: position unreachable' }));
                break;
            }
            // Send moveToAngle for each available joint (already inside queueCommand context)
            const moveSpeed = mSpeed !== undefined ? Number(mSpeed) : 1500;
            for (let ji = 0; ji < xyzAngles.length; ji++) {
                if (servos[ji] !== null) {
                    await servos[ji].moveToAngle(xyzAngles[ji], moveSpeed);
                }
            }
            ws.send(JSON.stringify({ type: 'moving', angles: xyzAngles, x: Number(mX), y: Number(mY), z: Number(mZ) }));

            // Stall monitor — poll until all joints reach target, a stall is detected, or timeout.
            // Keeps the command queue locked during the move so no new moves overlap.
            {
                const STALL_TIMEOUT_MS = 8000; // max time to wait for movement to complete
                const POLL_MS          = 200;  // how often to sample servo positions
                const POS_TOLERANCE    = 20;   // steps (~1.75°) — close enough counts as "at target"
                const STUCK_DELTA      = 5;    // steps — movement below this per poll = "not progressing"
                const STALL_POLLS      = 4;    // consecutive "not progressing" polls before declaring stall

                // Pre-compute target positions in steps (same formula as angleToSteps)
                const targetSteps = xyzAngles.map(a =>
                    Math.round(2048 + Math.max(-180, Math.min(180, a)) * (2048 / 180))
                );

                let stalledConsec = 0;
                let prevPositions = null;
                const deadline = Date.now() + STALL_TIMEOUT_MS;

                await new Promise(r => setTimeout(r, 250)); // let servos start moving before first poll

                while (Date.now() < deadline) {
                    let statuses;
                    try { statuses = await getAllServoStatus(); } catch (e) { break; }

                    const positions = statuses.map(s => s.position);

                    // Check if all active servos have reached their target positions
                    const allDone = xyzAngles.every((_, ji) => {
                        if (!servos[ji] || !statuses[ji] || !statuses[ji].available) return true;
                        return Math.abs(positions[ji] - targetSteps[ji]) <= POS_TOLERANCE;
                    });
                    if (allDone) break;

                    // Stall check: any servo not yet at target but barely moving?
                    if (prevPositions) {
                        const anyStuck = xyzAngles.some((_, ji) => {
                            if (!servos[ji] || !statuses[ji] || !statuses[ji].available) return false;
                            if (Math.abs(positions[ji] - targetSteps[ji]) <= POS_TOLERANCE) return false;
                            return Math.abs(positions[ji] - prevPositions[ji]) < STUCK_DELTA;
                        });

                        if (anyStuck) {
                            stalledConsec++;
                            if (stalledConsec >= STALL_POLLS) {
                                // Stall confirmed — disable torque on all servos immediately
                                for (const sv of servos) {
                                    if (sv) try { await sv.stopServo(); } catch (_) {}
                                }
                                console.warn('Stall detected — torque disabled on all servos');
                                ws.send(JSON.stringify({
                                    type: 'stall',
                                    message: 'Stall detected — servos stopped to prevent damage'
                                }));
                                break;
                            }
                        } else {
                            stalledConsec = 0;
                        }
                    }

                    prevPositions = positions;
                    await new Promise(r => setTimeout(r, POLL_MS));
                }
            }
            break;
        }

        case 'inverseKinematics': {
            // Compute joint angles from a target XYZ position (mm).
            // Body: { command: "inverseKinematics", x, y, z, orientation?: {x,y,z} }
            // Returns: { type: "ikResult", angles: [j1..j5] } (degrees) or { type: "error" }
            const { x: ikX, y: ikY, z: ikZ, orientation: ikOri } = data;
            if (ikX === undefined || ikY === undefined || ikZ === undefined) {
                ws.send(JSON.stringify({ type: 'error', message: 'inverseKinematics: x, y, z required' }));
                break;
            }
            if (!robotKinematics.isConfigured()) {
                ws.send(JSON.stringify({ type: 'error', message: 'inverseKinematics: URDF not loaded' }));
                break;
            }
            // Seed the IK solver with the robot's current joint angles so it finds
            // the nearest solution rather than jumping to an opposite configuration.
            let ikInitialAngles = null;
            try {
                const ikStatuses = await getAllServoStatus();
                const ikCurrentAngles = ikStatuses.filter(s => s.available).map(s => s.angleDegrees);
                if (ikCurrentAngles.length === robotKinematics.getJointCount()) {
                    ikInitialAngles = ikCurrentAngles;
                }
            } catch (e) { /* fall back to null seed */ }
            const targetPose = { x: Number(ikX), y: Number(ikY), z: Number(ikZ) };
            if (ikOri) targetPose.orientation = ikOri;
            const angles = robotKinematics.inverseKinematics(targetPose, ikInitialAngles);
            if (!angles) {
                ws.send(JSON.stringify({ type: 'error', message: 'inverseKinematics: position unreachable' }));
            } else {
                ws.send(JSON.stringify({ type: 'ikResult', angles }));
            }
            break;
        }

        default:
            ws.send(JSON.stringify({
                type: 'error',
                message: `Unknown command: ${command}`
            }));
    }
}

/**
 * Cleanup function - called on exit
 */
async function cleanup() {
    console.log('Shutting down...');
    
    // Stop all servos
    for (let i = 0; i < servos.length; i++) {
        if (servos[i] !== null) {
            try {
                await servos[i].stopServo();
                await servos[i].close();
            } catch (error) {
                console.error(`Error closing servo ${i + 1}:`, error.message);
            }
        }
    }
    
    // Close shared serial port
    if (sharedSerialPort && sharedSerialPort.isOpen) {
        await new Promise((resolve) => {
            sharedSerialPort.close((error) => {
                if (error) {
                    console.error('Error closing shared serial port:', error.message);
                } else {
                    console.log('Shared serial port closed');
                }
                resolve();
            });
        });
    }
    
    process.exit(0);
}

// Handle process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);


// Keep-alive: SC-B1 goes idle after ~3s of silence. Ping servo 1 every 1.5s.
let lastSerialActivity = Date.now();
let portOpenedAt = Date.now();
const PORT_SESSION_MS = 5200;
async function maybeReopenPort() {    if (!sharedSerialPort || !sharedSerialPort.isOpen) return;    const age = Date.now() - portOpenedAt;    if (age < PORT_SESSION_MS) return;    console.log("[PORT SESSION] Renewing after " + age + "ms...");    await new Promise((res) => { sharedSerialPort.close((err) => { if(err) console.error("Close err:", err.message); res(); }); });    await new Promise((res, rej) => { sharedSerialPort.open((err) => { if(err) { console.error("Reopen err:", err.message); rej(err); } else { portOpenedAt = Date.now(); lastSerialActivity = Date.now(); console.log("[PORT SESSION] Renewed"); res(); } }); });}
const origQueueWrite = queueWrite;
// Track last activity by wrapping queueWrite
async function trackedQueueWrite(writeFn) {
    lastSerialActivity = Date.now();
    return origQueueWrite(writeFn);
}

function startKeepAlive() {
    setInterval(async () => {
        const idle = Date.now() - lastSerialActivity;
        // Only send keep-alive if idle AND not already processing a command
        if (idle >= 900 && servos.length > 0 && !isProcessingCommand) {
            const s = servos.find(sv => sv !== null);
            if (s) {
                try {
                    // Run through command queue so it doesn't race with reads/writes
                    await queueCommand(async () => {
                        lastSerialActivity = Date.now();
                        await s.sendPacket(1, []); // keep SC-B1 active
                        await new Promise(r => setTimeout(r, 15)); // wait for response window
                    }, { type: 'keepAlive' });
                } catch(e) { /* ignore keep-alive errors */ }
            }
        }
    }, 500);
}

// Start the server
async function main() {
    try {
        // Initialize servos
        await initializeServos();
        
        // Start WebSocket server
        sharedSerialPort._writeQueue = trackedQueueWrite;
        lastSerialActivity = Date.now(); // reset after init so keep-alive doesn't fire immediately
        startKeepAlive();
        startServer();
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Run the main function
main();

