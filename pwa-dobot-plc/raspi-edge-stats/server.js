// Very simple stats server for Raspberry Pi
// Uses only built-in Node.js modules to keep load low.

const http = require('http');
const os = require('os');
const { exec } = require('child_process');

// Read CPU temperature using vcgencmd
function getCpuTemperature(callback) {
  exec('vcgencmd measure_temp', function (error, stdout, stderr) {
    if (error) {
      callback(null);
      return;
    }

    // Example output: temp=48.2'C
    const match = stdout.match(/temp=([\d\.]+)/);
    if (match && match[1]) {
      const tempCelsius = parseFloat(match[1]);
      callback(tempCelsius);
    } else {
      callback(null);
    }
  });
}

// Build the stats object with CPU, memory, uptime, temperature
function buildStats(callback) {
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const usedMemBytes = totalMemBytes - freeMemBytes;

  const totalMemMB = Math.round(totalMemBytes / 1024 / 1024);
  const usedMemMB = Math.round(usedMemBytes / 1024 / 1024);

  const loadAverages = os.loadavg(); // [1min, 5min, 15min]
  const cpuCount = os.cpus().length;

  const uptimeSeconds = os.uptime();

  getCpuTemperature(function (tempCelsius) {
    const stats = {
      cpu: {
        load1: loadAverages[0],
        load5: loadAverages[1],
        load15: loadAverages[2],
        coreCount: cpuCount
      },
      memory: {
        totalMB: totalMemMB,
        usedMB: usedMemMB
      },
      uptimeSeconds: uptimeSeconds,
      temperatureCelsius: tempCelsius
    };

    callback(stats);
  });
}

const server = http.createServer(function (req, res) {
  if (req.url === '/stats') {
    buildStats(function (stats) {
      const json = JSON.stringify(stats);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });

      res.end(json);
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

const PORT = 3000;

server.listen(PORT, function () {
  console.log('Raspberry Pi stats server listening on port ' + PORT);
});

