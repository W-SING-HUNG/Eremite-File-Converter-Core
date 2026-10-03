/**
 * Phase 3 — Zero-fetch proof via a loopback canary HTTP server.
 *
 * A real HTTP server on 127.0.0.1:<random port> records every incoming request.
 * Documents point hyperlinks / embedded resources at it. We then run the REAL
 * production pipeline (real Pandoc 3.10.x + --sandbox, no mocks) and assert:
 *  - ordinary hyperlinks convert and are preserved, yet the canary gets 0 hits;
 *  - embedded resources are rejected by preflight BEFORE pandoc spawns, 0 hits.
 * No public network is contacted; example.invalid is not relied upon.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDevConverter } from '../src/dev/api.js';

interface Hit { method: string; url: string }

let tmpRoot: string;
let outDir: string;
let converter: ReturnType<typeof createDevConverter>;
let server: http.Server;
let port = 0;
const hits: Hit[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fc-zerofetch-'));
  outDir = path.join(tmpRoot, 'out');
  await fsp.mkdir(outDir, { recursive: true });
  converter = createDevConverter();
  await new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      hits.push({ method: req.method ?? '?', url: req.url ?? '?' });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('canary');
    });
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

async function writeDoc(name: string, content: string): Promise<string> {
  const p = path.join(tmpRoot, name);
  await fsp.writeFile(p, content, 'utf8');
  return p;
}

async function run(sourcePath: string, target: string) {
  const before = hits.length;
  const r = await converter.convert({
    sourcePath, targetFormat: target as any,
    output: { directory: outDir, conflict: 'version' },
  });
  await sleep(150); // settle window for any (forbidden) async fetch
  return { r, received: hits.length - before };
}

describe('zero-fetch canary (real pandoc + sandbox)', () => {
  it('1. MD ordinary hyperlink: PASS, href kept, 0 fetch', async () => {
    const src = await writeDoc('link.md', `# T\n\n[test](http://127.0.0.1:${port}/ordinary-md)\n`);
    const { r, received } = await run(src, 'html');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const html = await fsp.readFile(r.output.path, 'utf8');
    expect(html).toContain(`href="http://127.0.0.1:${port}/ordinary-md"`);
    expect(received).toBe(0);
  });

  it('2. HTML ordinary hyperlink: PASS, link kept, 0 fetch', async () => {
    const src = await writeDoc('link.html',
      `<p><a href="http://127.0.0.1:${port}/ordinary-html">test</a></p>`);
    const { r, received } = await run(src, 'markdown');
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const md = await fsp.readFile(r.output.path, 'utf8');
    expect(md).toContain(`(http://127.0.0.1:${port}/ordinary-html)`);
    expect(received).toBe(0);
  });

  it('3. MD remote image: resource_bundle_required pre-spawn, 0 fetch', async () => {
    const src = await writeDoc('img.md', `# t\n\n![x](http://127.0.0.1:${port}/image.png)\n`);
    const { r, received } = await run(src, 'html');
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.error.code).toBe('FC_RESOURCE_BUNDLE_REQUIRED');
    expect(received).toBe(0);
  });

  it('4. HTML remote image: resource_bundle_required pre-spawn, 0 fetch', async () => {
    const src = await writeDoc('img.html', `<p>x</p><img src="http://127.0.0.1:${port}/image.png">`);
    const { r, received } = await run(src, 'markdown');
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.error.code).toBe('FC_RESOURCE_BUNDLE_REQUIRED');
    expect(received).toBe(0);
  });

  it('5. HTML iframe: resource_bundle_required pre-spawn, 0 fetch', async () => {
    const src = await writeDoc('frame.html', `<iframe src="http://127.0.0.1:${port}/frame"></iframe>`);
    const { r, received } = await run(src, 'markdown');
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.error.code).toBe('FC_RESOURCE_BUNDLE_REQUIRED');
    expect(received).toBe(0);
  });

  it('canary received ZERO requests across the whole suite', () => {
    expect(hits.length).toBe(0);
  });
});
