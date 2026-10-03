import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { makeHostHarness, type HostHarness } from './helpers/host-harness.js';
import { PNG_HEAD } from './helpers/fixtures.js';
import { canCreateJunction } from './helpers/reparse.js';
import { TOOL_VERSION } from '../src/core/constants.js';
import type { HostInvocationRequest, HostInvocationResponse } from '../src/core/types.js';

/** The real packaged CLI (dist/cli/index.js). Spawned under process.execPath (Node 24). */
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli', 'index.js');
const cliExists = await fsp.access(CLI).then(() => true).catch(() => false);
const packageVersion = (JSON.parse(await fsp.readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')) as { version: string }).version;
const junctionSupported = await canCreateJunction();

describe('release identity gate', () => {
  it('requires a built production CLI', () => {
    expect(cliExists).toBe(true);
  });
});

/** Generate a real UUIDv7: 48-bit ms timestamp, version nibble 7, variant 10xx. */
function uuidV7(): string {
  const b = randomBytes(16);
  const ms = Date.now();
  b[0] = Math.floor(ms / 2 ** 40) & 0xff;
  b[1] = Math.floor(ms / 2 ** 32) & 0xff;
  b[2] = Math.floor(ms / 2 ** 24) & 0xff;
  b[3] = Math.floor(ms / 2 ** 16) & 0xff;
  b[4] = Math.floor(ms / 2 ** 8) & 0xff;
  b[5] = ms & 0xff;
  b[6] = 0x70 | (b[6]! & 0x0f); // version = 7
  b[8] = 0x80 | (b[8]! & 0x3f); // variant = 10x
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', () => resolve({ code: -1, stdout, stderr }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe.skipIf(!cliExists)('Host Contract v1.1 packaged CLI (real subprocess)', () => {
  let h: HostHarness;
  let png: Buffer;
  beforeAll(async () => {
    h = await makeHostHarness();
    png = await sharp({ create: { width: 8, height: 6, channels: 4, background: { r: 10, g: 200, b: 90, alpha: 1 } } }).png().toBuffer();
  });
  afterAll(async () => { await h.cleanup(); });

  async function writeProtocolFiles(req: HostInvocationRequest, respName = 'response.json') {
    const reqPath = path.join(h.root, 'request.json');
    const respPath = path.join(h.root, respName);
    await fsp.writeFile(reqPath, JSON.stringify(req));
    return { reqPath, respPath };
  }

  async function invoke(req: HostInvocationRequest): Promise<{ code: number; resp: HostInvocationResponse }> {
    const { reqPath, respPath } = await writeProtocolFiles(req);
    const { code } = await runCli(['--protocol', '1', '--request', reqPath, '--response', respPath]);
    const resp = JSON.parse(await fsp.readFile(respPath, 'utf8')) as HostInvocationResponse;
    return { code, resp };
  }

  it('markdown-to-html succeeds: exit 0, fixed output written, engine pandoc, fallback false', async () => {
    const src = await h.writeSource('source', Buffer.from('# H\n\ntext [a](https://example.invalid/)\n'));
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'markdown-to-html', outputName: 'result.html' });
    const { code, resp } = await invoke(req);
    expect(code).toBe(0);
    expect(resp.status).toBe('succeeded');
    if (resp.status !== 'succeeded') throw new Error(JSON.stringify(resp));
    expect(resp.engine.id).toBe('pandoc');
    expect(resp.fallback.used).toBe(false);
    expect(resp.target.formatId).toBe('html');
    const out = await fsp.readFile(req.workspace.outputPath, 'utf8');
    expect(out).toContain('<h1');
    expect(out).toContain('example.invalid');
  });

  it('release identity: package version == TOOL_VERSION == real response.coreVersion (image success)', async () => {
    const src = await h.writeSource('source', png);
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'result.jpg' });
    const { code, resp } = await invoke(req);
    expect(code).toBe(0);
    expect(resp.status).toBe('succeeded');
    if (resp.status !== 'succeeded') throw new Error(JSON.stringify(resp));
    expect(resp.invocationId).toBe(req.invocationId);
    expect(packageVersion).toBe('1.1.2');
    expect(TOOL_VERSION).toBe(packageVersion);
    expect(resp.coreVersion).toBe(packageVersion);
    expect(resp.engine.id).toBe('sharp');
    expect((await fsp.readFile(req.workspace.outputPath)).subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('business failure (malformed image) -> status failed AND exit 0', async () => {
    const src = await h.writeSource('source', Buffer.concat([PNG_HEAD, Buffer.alloc(4)]));
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'x.jpg' });
    const { code, resp } = await invoke(req);
    expect(code).toBe(0);
    expect(resp.status).toBe('failed');
    if (resp.status !== 'failed') throw new Error('expected failed');
    expect(resp.errors[0]?.code).toMatch(/^FC_/);
  });

  it('source sha256 mismatch -> FC_SOURCE_CHANGED, exit 0', async () => {
    const src = await h.writeSource('source', png);
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'h.jpg', tamper: { sha256: 'a'.repeat(64) } });
    const { code, resp } = await invoke(req);
    expect(code).toBe(0);
    expect(resp.status).toBe('failed');
    if (resp.status !== 'failed') throw new Error('x');
    expect(resp.errors[0]?.code).toBe('FC_SOURCE_CHANGED');
  });

  it('source byteSize mismatch -> FC_SOURCE_CHANGED, exit 0', async () => {
    const src = await h.writeSource('source', png);
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 's.jpg', tamper: { byteSize: 999999 } });
    const { code, resp } = await invoke(req);
    expect(code).toBe(0);
    expect(resp.status).toBe('failed');
    if (resp.status !== 'failed') throw new Error('x');
    expect(resp.errors[0]?.code).toBe('FC_SOURCE_CHANGED');
  });

  it('non-UUID invocationId is a non-zero protocol failure', async () => {
    const src = await h.writeSource('source', png);
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'u.jpg', invocationId: 'not-a-uuid' });
    const { reqPath, respPath } = await writeProtocolFiles(req);
    const { code } = await runCli(['--protocol', '1', '--request', reqPath, '--response', respPath]);
    expect(code).not.toBe(0);
  });

  it('UUIDv7 invocationId is accepted end-to-end (not just v4)', async () => {
    const src = await h.writeSource('source', png);
    const v7 = uuidV7();
    expect(v7).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'v7.jpg', invocationId: v7 });
    const { code, resp } = await invoke(req);
    expect(code).toBe(0);
    expect(resp.status).toBe('succeeded');
    if (resp.status !== 'succeeded') throw new Error(JSON.stringify(resp));
    // the v7 id round-trips unchanged and the canonical success shape holds
    expect(resp.invocationId).toBe(v7);
    expect(resp.engine.id).toBe('sharp');
    expect(typeof resp.engine.version).toBe('string');
    expect(resp.fallback.used).toBe(false);
  });

  it('unsupported protocol major is a non-zero failure', async () => {
    const src = await h.writeSource('source', png);
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'p.jpg' });
    const { reqPath, respPath } = await writeProtocolFiles(req);
    const { code } = await runCli(['--protocol', '2', '--request', reqPath, '--response', respPath]);
    expect(code).not.toBe(0);
  });

  it('missing request file -> non-zero', async () => {
    const { code } = await runCli(['--protocol', '1', '--request', path.join(h.root, 'nope.json'), '--response', path.join(h.root, 'r.json')]);
    expect(code).not.toBe(0);
  });

  it('response path escaping the workspace -> non-zero (no response written)', async () => {
    const src = await h.writeSource('source', png);
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'esc.jpg' });
    const { reqPath } = await writeProtocolFiles(req);
    const outsideResp = path.join(os.tmpdir(), `fc-escape-resp-${Date.now()}.json`);
    const { code } = await runCli(['--protocol', '1', '--request', reqPath, '--response', outsideResp]);
    expect(code).not.toBe(0);
    expect(await fsp.access(outsideResp).then(() => true).catch(() => false)).toBe(false);
  });

  it.skipIf(!junctionSupported)('output parent is an external junction -> non-zero (reparse escape)', async () => {
    const src = await h.writeSource('source', png);
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'r.jpg' });
    const outside = path.join(h.root, '..', `outside-out-${Date.now()}`);
    await fsp.mkdir(outside, { recursive: true });
    const junctionDir = path.join(h.root, 'out-junction');
    try {
      await fsp.symlink(outside, junctionDir, 'junction');
      req.workspace.outputPath = path.join(junctionDir, 'r.jpg');
      const { reqPath, respPath } = await writeProtocolFiles(req);
      const { code } = await runCli(['--protocol', '1', '--request', reqPath, '--response', respPath]);
      expect(code).not.toBe(0);
    } finally {
      await fsp.rm(junctionDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(outside, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('scratch under work/ is removed after a successful invocation', async () => {
    const src = await h.writeSource('source2', Buffer.from('# hi\n'));
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'markdown-to-html', outputName: 'clean.html' });
    const { code } = await invoke(req);
    expect(code).toBe(0);
    const leftover = await fsp.readdir(h.workDir).catch(() => [] as string[]);
    expect(leftover).toEqual([]);
  });
});
