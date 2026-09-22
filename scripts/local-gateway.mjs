import http from 'node:http';
import { spawn } from 'node:child_process';

// One public origin for the UI, API and realtime events. Never accept a target
// URL from the browser: upstreams are fixed by the local deployment.
const api = new URL(process.env.OPENWA_INTERNAL_URL || 'http://openwa:2785');
const ui = new URL('http://127.0.0.1:3001');
if (api.protocol !== 'http:') throw new Error('Local OpenWA upstream must use HTTP.');
const child = spawn(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', '.wrangler/state', '--ip', '127.0.0.1', '--port', '3001'], { stdio: 'inherit' });
function target(path) { return /^\/(api(?:\/|\?|$)|socket\.io(?:\/|\?|$))/.test(path) ? api : ui; }
function options(req) {
  const upstream = target(req.url || '/');
  return { hostname: upstream.hostname, port: upstream.port || 80, path: req.url, method: req.method, headers: { ...req.headers, host: upstream.host } };
}
const server = http.createServer((req, res) => {
  const upstream = http.request(options(req), response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
    response.on('error', () => res.destroy());
  });
  upstream.on('error', () => {
    if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'Servidor temporariamente indisponível. Tente novamente em instantes.' })); }
    else res.destroy();
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/socket.io/')) { socket.destroy(); return; }
  const upstream = http.request(options(req));
  upstream.on('upgrade', (response, remote, remoteHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` + response.rawHeaders.reduce((text, value, index, headers) => index % 2 ? text : text + `${value}: ${headers[index + 1]}\r\n`, '') + '\r\n');
    if (remoteHead.length) socket.write(remoteHead);
    if (head.length) remote.write(head);
    remote.on('error', () => socket.destroy());
    socket.on('error', () => remote.destroy());
    remote.on('close', () => socket.destroy());
    socket.on('close', () => remote.destroy());
    remote.pipe(socket).pipe(remote);
  });
  upstream.on('response', response => { response.resume(); socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`); });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  upstream.end();
});
server.listen(3000, '0.0.0.0');
function stop() { server.close(); child.kill('SIGTERM'); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', code => { server.close(); process.exit(code ?? 1); });
child.on('error', () => { server.close(); process.exit(1); });
