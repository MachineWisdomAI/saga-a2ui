import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Static server for the built Web host, plus one endpoint that never answers so the tests can
// tell whether an aborted request really dropped its connection.

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const dist = path.join(appRoot, 'dist');
const port = Number(process.env['PORT'] ?? 4174);

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

const slow = { opened: 0, closedBeforeAnswer: 0 };

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/slow') {
    slow.opened += 1;
    let answered = false;
    response.on('close', () => {
      if (!answered) slow.closedBeforeAnswer += 1;
    });
    // Deliberately never answered.
    return;
  }
  if (url.pathname === '/__slow-state') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(slow));
    return;
  }
  const relative =
    url.pathname === '/'
      ? 'index.html'
      : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(dist, relative);
  if (
    !file.startsWith(dist + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    response.writeHead(404);
    response.end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': types[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`lynx fixture host on http://127.0.0.1:${port}`);
});
