import re

path = '/home/pi/sf2/pwa-dobot-plc/robotarmv3-pi-service/robotArmST3215.js'
with open(path, 'r') as f:
    content = f.read()

# Fix 1: raise readData timeout from 10ms to 50ms
before = len(content)
content = content.replace(
    '// Set timeout (10ms) - increased for shared port scenarios',
    '// Set timeout (50ms) - servo needs time to process and respond',
    1
)
print('Fix 1 (read timeout):', 'OK' if len(content) != before else 'already patched or not found')

# Fix 2: replace writeData - fire-and-forget (no waiting for write ACK)
# Find the async writeData method and replace its body
old_marker_start = '    async writeData(address, data) {'
old_marker_end   = '        // Wait for response and return true on success\n        const result = await writePromise;\n        return true;\n    }'

start = content.find(old_marker_start)
end   = content.find(old_marker_end)

if start == -1 or end == -1:
    print('Fix 2: ERROR - could not find writeData boundaries')
    print('  start found:', start != -1)
    print('  end found:', end != -1)
else:
    end += len(old_marker_end)
    new_write = '''    async writeData(address, data) {
        const parameters = [address & 0xFF, ...data];

        if (DEBUG) console.log('[DEBUG Servo ' + this.servoId + '] writeData addr=0x' + (address & 0xFF).toString(16).padStart(2,'0') + ' data=' + JSON.stringify(data));

        // Clear any stale pending state
        this.pendingResponse = null;
        if (this.responseTimeout) { clearTimeout(this.responseTimeout); this.responseTimeout = null; }
        this.responseResolve = null;
        this.responseReject = null;

        // Fire-and-forget: ST3215 servos do not reliably send a write ACK
        // when Status Return Level = 0 (factory default on many units).
        // Send the packet then wait a short drain time before returning.
        await this.sendPacket(INST_WRITE, parameters);
        await new Promise(r => setTimeout(r, 8));
        return true;
    }'''
    content = content[:start] + new_write + content[end:]
    print('Fix 2 (fire-and-forget write): OK')

with open(path, 'w') as f:
    f.write(content)
print('Saved.')
