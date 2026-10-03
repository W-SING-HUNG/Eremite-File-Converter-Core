import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers/fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const NODE = 'D:\\Node js\\node.exe';
const SERVER = path.join(ROOT, 'dev-harness', 'backend', 'server.ts');

function request(port: number, pathname: string, opts: { token?: string; host?: string; method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : undefined;
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method: opts.method ?? (data ? 'POST' : 'GET'),
      headers: {
        ...(opts.token ? { 'x-qa-token': opts.token } : {}),
        ...(opts.host ? { Host: opts.host } : {}),
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

describe('QA backend loopback hardening', () => {
  let proc: ReturnType<typeof spawn>;
  let port = 0;
  let token = '';

  beforeAll(async () => {
    proc = spawn(NODE, ['--import', 'tsx', SERVER], { cwd: ROOT, env: { ...process.env, QA_PORT: '0' } });
    const line = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('backend start timeout')), 15000);
      proc.stdout!.on('data', (d) => { const s = String(d); if (s.includes('url')) { clearTimeout(t); resolve(s); } });
      proc.on('exit', (c) => reject(new Error(`backend exited ${c}`)));
    });
    const j = JSON.parse(line.trim().split('\n')[0]!);
    const u = new URL(j.url);
    port = Number(u.port);
    token = j.token;
    expect(port).toBeGreaterThan(0);
  }, 20000);

  afterAll(() => proc?.kill());

  it('rejects requests without token', async () => {
    expect((await request(port, '/api/health')).status).toBe(401);
  });

  it('serves health with token', async () => {
    const r = await request(port, '/api/health', { token });
    expect(r.status).toBe(200);
    expect(r.body.qaOnly).toBe(true);
  });

  it('rejects non-loopback Host header', async () => {
    const r = await request(port, '/api/health', { token, host: 'evil.example.com' });
    expect(r.status).toBe(403);
  });

  it('detect works through the in-process core', async () => {
    const dir = await tmpDir();
    const f = path.join(dir, 'a.md');
    await fsp.writeFile(f, '# x\n');
    const r = await request(port, '/api/detect', { token, body: { sourcePath: f } });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('markdown');
  });
});
