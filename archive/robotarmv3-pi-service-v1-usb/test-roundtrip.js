// Round-trip test: move from current pose to an intermediate "away" pose,
// then back to the original. Reports per-leg success, faults, final position
// error, and elapsed time. No early "PASS" declarations.
const WebSocket = require('ws');
const https = require('https');

const HOME = { x: -337, y: 95,  z: 338 };  // user's chosen home
const AWAY = { x: -150, y: 200, z: 300 };  // intermediate
const SPEED = 1000;
const SETTLE_MS = 4000;
const POLL_MS   = 400;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function dist(a, b) { const dx=(a.x||0)-(b.x||0), dy=(a.y||0)-(b.y||0), dz=(a.z||0)-(b.z||0); return Math.sqrt(dx*dx+dy*dy+dz*dz); }
function getStatus() {
    return new Promise((resolve, reject) => {
        const req = https.request({ hostname:'localhost', port:8080, path:'/api/robot-arm/status', method:'GET', rejectUnauthorized:false }, (res) => {
            let s=''; res.on('data', c => s+=c); res.on('end', () => { try { resolve(JSON.parse(s).status); } catch (e) { reject(e); } });
        });
        req.on('error', reject); req.end();
    });
}

async function runLeg(ws, label, target) {
    console.log(`\n=== ${label} → (${target.x}, ${target.y}, ${target.z}) ===`);
    const startStatus = await getStatus();
    console.log(`  starting TCP: ${JSON.stringify(startStatus.currentXYZ)}`);
    const startMs = Date.now();
    let bridgeResp = null;
    const handler = (m) => {
        const d = JSON.parse(m.toString());
        if (d.type === 'connected') return;
        if (d.type === 'moving' || d.type === 'error' || d.type === 'stall') {
            bridgeResp = d;
            ws.removeListener('message', handler);
        }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ command:'moveToXYZ', x:target.x, y:target.y, z:target.z, speed:SPEED }));
    await new Promise(r => setTimeout(r, 2500));
    if (bridgeResp === null) { ws.removeListener('message', handler); bridgeResp = { type: 'timeout-on-resp' }; }
    console.log(`  bridge said: ${bridgeResp.type}` +
        (bridgeResp.type === 'moving' ? ` (positionErrorMm=${(bridgeResp.positionErrorMm||0).toFixed(1)})` :
         bridgeResp.type === 'error' ? ` — ${bridgeResp.message}` :
         bridgeResp.type === 'stall' ? ` — ${bridgeResp.cause}` : ''));

    const faults = new Set();
    let lastTcp = null;
    const settleUntil = Date.now() + SETTLE_MS;
    while (Date.now() < settleUntil) {
        try {
            const s = await getStatus();
            lastTcp = s.currentXYZ;
            for (const j of s.joints) {
                if (j.faultByte) faults.add(`J${j.joint}=${j.faultDescription}`);
            }
        } catch (e) {}
        await sleep(POLL_MS);
    }
    const err = lastTcp ? dist(lastTcp, target) : null;
    console.log(`  final TCP: ${JSON.stringify(lastTcp)}`);
    console.log(`  position error: ${err === null ? '?' : err.toFixed(1)} mm`);
    console.log(`  faults during move: ${faults.size ? [...faults].join(', ') : 'none'}`);
    console.log(`  elapsed: ${Date.now() - startMs} ms`);
    return { label, bridge: bridgeResp.type, err, faults: [...faults], elapsed: Date.now() - startMs };
}

(async () => {
    const ws = new WebSocket('ws://localhost:8090');
    await new Promise(r => ws.once('open', r));
    await new Promise(r => ws.once('message', r)); // connected

    const initial = await getStatus();
    console.log(`Initial TCP: ${JSON.stringify(initial.currentXYZ)}`);

    const leg1 = await runLeg(ws, 'LEG 1: home → AWAY', AWAY);
    await sleep(1500); // breather between legs
    const leg2 = await runLeg(ws, 'LEG 2: AWAY → home', HOME);

    console.log('\n========== SUMMARY ==========');
    for (const r of [leg1, leg2]) {
        const ok = r.bridge === 'moving' && r.err !== null && r.err < 30 && r.faults.length === 0;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(25)} err=${r.err === null ? '?' : r.err.toFixed(1)+'mm'}  bridge=${r.bridge}  faults=[${r.faults.join(',')}]`);
    }
    ws.close();
    process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(99); });
