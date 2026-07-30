// server/kibana/client.cjs — Kibana baglantisi (Artim 2: yalnizca saglik kontrolu)
//
// Bu sprintte yalnizca erisilebilirlik teyidi yapilir; gercek Elasticsearch/Kibana
// arama/dashboard entegrasyonu ertelendi (yalnizca canli erisim teyit edilirse yapilacak).
'use strict';

const net = require('net');

function isConfigured() {
  return !!(process.env.KIBANA_BASE_URL || '').trim();
}

// dynatrace/client.cjs / splunk/client.cjs ile ayni TCP-probe deseni.
function checkReachable(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const baseUrl = (process.env.KIBANA_BASE_URL || '').trim();
    let parsed;
    try { parsed = new URL(baseUrl); } catch { return resolve(false); }
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    const socket = net.createConnection({ host: parsed.hostname, port, timeout: timeoutMs });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

module.exports = { isConfigured, checkReachable };
