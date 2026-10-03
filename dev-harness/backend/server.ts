/**
 * DEV/QA ONLY backend. Vite+React frontend -> 127.0.0.1-only Node QA backend
 * -> in-process file-converter-core. This is NOT an Eremite UI and may be
 * deleted without touching src/core. It imports the QA stub engine DIRECTLY from
 * its engine module (the stub is absent from the production public exports).
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDevConverter, SharpEngine, PandocEngine, LibreOfficeEngine, type ConvertRequest } from '../../src/dev/api.js';
import { QaStubEngine } from '../../src/dev/qa-stub.js';
import { assertSupportedRuntime } from '../../src/core/runtime-guard.js';

try {
  assertSupportedRuntime('file-converter-core QA backend');
} catch (e) {
  process.stderr.write((e as Error).message + '\n');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(here, '../frontend/dist');
const PORT = Number(process.env.QA_PORT ?? 5199);
const HOST = '127.0.0.1';
// Random token by default; QA_TOKEN override for reproducible black-box testing.
const token = process.env.QA_TOKEN || randomBytes(12).toString('hex');

// QA backend registers the three real engines plus the QA stub (synthesized
// output for pairs that have no real engine). Real engines always take priority.
const converter = createDevConverter({ engines: [new SharpEngine(), new PandocEngine(), new LibreOfficeEngine(), new QaStubEngine()] });

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    // Loopback-only hardening: reject foreign Host headers (port-insensitive).
    const hostName = (req.headers.host ?? '').split(':')[0]?.replace(/^\[|\]$/g, '');
    if (hostName && !ALLOWED_HOSTS.has(hostName)) {
      return json(res, 403, { error: 'non-loopback host rejected' });
    }
    if (url.pathname.startsWith('/api/')) {
      const authed = req.headers['x-qa-token'] === token || url.searchParams.get('token') === token;
      if (!authed) return json(res, 401, { error: 'bad qa token' });
      if (url.pathname === '/api/health') return json(res, 200, { ok: true, qaOnly: true });
      if (url.pathname === '/api/capabilities') return json(res, 200, await converter.getCapabilities());
      if (url.pathname === '/api/detect' && req.method === 'POST') {
        const { sourcePath } = JSON.parse(await readBody(req)) as { sourcePath: string };
        return json(res, 200, await converter.detectFile(sourcePath));
      }
      if (url.pathname === '/api/convert' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as ConvertRequest;
        return json(res, 200, await converter.convert(body));
      }
      if (url.pathname === '/api/open' && req.method === 'POST') {
        // DEV/QA ONLY convenience: reveal a file / open a folder locally.
        const { what, target } = JSON.parse(await readBody(req)) as { what: 'file' | 'dir'; target: string };
        if (typeof target !== 'string' || !target) return json(res, 400, { error: 'target required' });
        await fsp.access(target); // throws -> 500 if missing
        if (process.platform === 'win32') {
          const args = what === 'file' ? ['/select,', target] : [target];
          spawn('explorer.exe', args, { detached: true, stdio: 'ignore' }).unref();
        }
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    }
    // Static frontend (production build only; dev uses Vite proxy).
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(FRONTEND_DIST, rel);
    if (!file.startsWith(FRONTEND_DIST)) return json(res, 403, { error: 'forbidden' });
    const buf = await fsp.readFile(file).catch(() => null);
    if (!buf) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<h1>file-converter-core QA backend</h1><p>Frontend not built. Run: npm run harness:build, or use npm run harness:frontend.</p>');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const bound = typeof addr === 'object' && addr ? addr.port : PORT;
  process.stdout.write(JSON.stringify({ qaBackend: 'DEV/QA ONLY — not Eremite UI', url: `http://${HOST}:${bound}/`, token, note: '127.0.0.1 bound only' }) + '\n');
});
