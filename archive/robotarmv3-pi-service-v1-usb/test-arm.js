// Test harness — runs a sequence of XYZ moves, polls status after each,
// and reports per-target success, joint convergence, faults, and timing.
// Run on the Pi: node test-arm.js
const WebSocket = require('ws');
const https = require('https');

const TARGETS = [
    { label: 'small drop',     x: 84,   y: 381,  z: 50,  tol: 25 },
    { label: 'mid pull-back',  x: 200,  y: 200,  z: 300, tol: 25 },
    { label: 'cross-body',     x: -200, y: 200,  z: 250, tol: 25 },
    { label: 'above base',     x: 100,  y: 0,    z: 400, tol: 25 },
    { label: 'user home -X',   x: -345, y: 100,  z: 360, tol: 25 },
    { label: 'far reach +X',   x: 300,  y: 50,   z: 200, tol: 25 },
];

const SETTLE_MS = 3500;       // wait for joints to reach target
const POLL_INTERVAL_MS = 400; // status poll cadence during settle

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getStatus() {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'localhost', port: 8080, path: '/api/robot-arm/status',
            method: 'GET', rejectUnauthorized: false
        };
        const req = https.request(opts, (res) => {
            let chunks = '';
            res.on('data', (c) => { chunks += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(chunks).status); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function summarizeJoints(s) {
    const faults = s.joints.filter(j => j.faultByte).map(j => `J${j.joint}=${j.faultDescription}(0x${j.faultByte.toString(16)})`);
    const degraded = s.joints.filter(j => j.degraded).map(j => `J${j.joint}=${j.degradedReason}`);
    const offline  = s.joints.filter(j => !j.available).map(j => `J${j.joint}=${j.offlineReason||'?'}`);
    return { faults, degraded, offline };
}

function distMm(a, b) {
    const dx = (a.x||0) - (b.x||0), dy = (a.y||0) - (b.y||0), dz = (a.z||0) - (b.z||0);
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

async function runMove(ws, target) {
    return new Promise((resolve) => {
        let resp = null;
        const handler = (m) => {
            const d = JSON.parse(m.toString());
            if (d.type === 'connected') return;
            if (d.type === 'moving' || d.type === 'error' || d.type === 'stall' || d.type === 'ikFail') {
                resp = d;
                ws.removeListener('message', handler);
                resolve(d);
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({
            command: 'moveToXYZ',
            x: target.x, y: target.y, z: target.z, speed: 1000
        }));
        setTimeout(() => {
            if (!resp) { ws.removeListener('message', handler); resolve({ type: 'timeout' }); }
        }, 2500);
    });
}

(async () => {
    const ws = new WebSocket('ws://localhost:8090');
    await new Promise((resolve) => ws.once('open', resolve));
    await new Promise((resolve) => ws.once('message', resolve)); // swallow "connected"

    const results = [];
    for (const target of TARGETS) {
        console.log(`\n=== ${target.label} → (${target.x}, ${target.y}, ${target.z}) ===`);
        const sentAt = Date.now();
        const moveResp = await runMove(ws, target);
        console.log(`  bridge response: ${moveResp.type}` +
            (moveResp.type === 'moving' ? ` (positionErrorMm=${(moveResp.positionErrorMm||0).toFixed(1)})` :
             moveResp.type === 'error' ? ` — ${moveResp.message}` :
             moveResp.type === 'stall' ? ` — ${moveResp.cause}` : ''));

        // Watch the arm settle / report any faults that surface during the move
        const faultsObserved = new Set();
        const degradedObserved = new Set();
        let lastTcp = null;
        let lastJoints = null;
        const settleStart = Date.now();
        while (Date.now() - settleStart < SETTLE_MS) {
            try {
                const s = await getStatus();
                lastTcp = s.currentXYZ;
                lastJoints = s.joints;
                const summary = summarizeJoints(s);
                for (const f of summary.faults) faultsObserved.add(f);
                for (const d of summary.degraded) degradedObserved.add(d);
            } catch (e) {}
            await sleep(POLL_INTERVAL_MS);
        }

        const xyzErr = lastTcp ? distMm(lastTcp, target) : null;
        const stalled = lastJoints ? lastJoints.filter(j => j.speed === 0 && j.isMoving === false).length : null;

        const summary = {
            target: target.label,
            cmd: { x: target.x, y: target.y, z: target.z },
            bridgeResp: moveResp.type,
            bridgeMsg: moveResp.message || moveResp.cause || null,
            finalTcp: lastTcp,
            xyzErrMm: xyzErr !== null ? Number(xyzErr.toFixed(1)) : null,
            withinTol: xyzErr !== null ? (xyzErr <= target.tol) : false,
            faultsObserved: [...faultsObserved],
            degradedObserved: [...degradedObserved],
            elapsedMs: Date.now() - sentAt
        };
        results.push(summary);
        console.log(`  final TCP: ${JSON.stringify(lastTcp)} (err ${summary.xyzErrMm}mm, withinTol=${summary.withinTol})`);
        if (summary.faultsObserved.length) console.log(`  FAULTS DURING MOVE: ${summary.faultsObserved.join(', ')}`);
        if (summary.degradedObserved.length) console.log(`  degraded comms: ${summary.degradedObserved.join(', ')}`);
    }

    console.log('\n\n========== TEST SUMMARY ==========');
    let pass = 0, fail = 0;
    for (const r of results) {
        const status = r.withinTol && r.faultsObserved.length === 0 ? 'PASS' : 'FAIL';
        if (status === 'PASS') pass++; else fail++;
        console.log(`${status}  ${r.target.padEnd(18)} cmd=(${r.cmd.x},${r.cmd.y},${r.cmd.z})  err=${r.xyzErrMm}mm  ${r.faultsObserved.length ? ' FAULTS=['+r.faultsObserved.join(',')+']' : ''}  ${r.degradedObserved.length ? 'DEGRADED=['+r.degradedObserved.join(',')+']' : ''}`);
    }
    console.log(`\n${pass}/${results.length} passed.`);
    ws.close();
    process.exit(fail === 0 ? 0 : 1);
})();
