import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sdkFile = resolve(here, '../../packages/core/dist/speechpad.js');
const port = Number(process.env['PORT'] ?? 5174);
const host = '127.0.0.1';

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
]);

async function send(response, file) {
  const info = await stat(file);
  response.writeHead(200, {
    'content-type': TYPES.get(extname(file)) ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;

  if (requested === '/speechpad.js') {
    send(response, sdkFile).catch(() => {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Сначала соберите ядро: npm run build -w @speechpad/core');
    });
    return;
  }

  const target = resolve(here, `.${normalize(requested)}`);
  if (!target.startsWith(here)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  send(response, target).catch(() => {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });
});

server.listen(port, host, () => {
  console.log(`Speechpad SDK example: http://${host}:${port}/`);
});
