import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'pages');
const port = Number(process.env.PAGES_PREVIEW_PORT ?? 4184), prefix = '/pmtk3/';
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };
createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    if (pathname === '/pmtk3' || pathname === '/') { response.writeHead(302, { Location: prefix }).end(); return; }
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end('Not found'); return; }
    const relative = pathname.slice(prefix.length) || 'index.html', file = path.resolve(root, relative);
    if (relative.includes('\\') || !file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error instanceof URIError) response.writeHead(400).end('Malformed URL');
    else if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) response.writeHead(404).end('Not found');
    else { console.error(error); response.writeHead(500).end('Preview failed'); }
  }
}).listen(port, '127.0.0.1', () => console.log(`Static Pages preview: http://127.0.0.1:${port}${prefix}`));
