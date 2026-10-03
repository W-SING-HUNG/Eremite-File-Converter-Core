import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { makeHostHarness, type HostHarness } from './helpers/host-harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const NODE = 'D:\\Node js\\node.exe';
const CLI = path.join(ROOT, 'src', 'cli', 'index.ts');

function run(args: string[], bin: string = NODE): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['--import', 'tsx', CLI, ...args], { cwd: ROOT });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe('file-converter-core CLI (production protocol only)', () => {
  let h: HostHarness | null = null;
  afterAll(async () => { if (h) { await h.cleanup(); h = null; } });

  it('--help prints usage and exits 0', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('--protocol 1');
  });

  it('an unknown command is a non-zero usage failure', async () => {
    const r = await run(['capabilities']);
    expect(r.code).not.toBe(0);
  });

  it('production protocol: valid request -> exit 0 and a succeeded response', async () => {
    h = await makeHostHarness();
    const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: { r: 10, g: 200, b: 90 } } }).png().toBuffer();
    const src = await h.writeSource('source', png);
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'result.jpg' });
    const reqPath = path.join(h.root, 'request.json');
    const respPath = path.join(h.root, 'response.json');
    await fsp.writeFile(reqPath, JSON.stringify(req));
    const r = await run(['--protocol', '1', '--request', reqPath, '--response', respPath]);
    expect(r.code).toBe(0);
    const resp = JSON.parse(await fsp.readFile(respPath, 'utf8'));
    expect(resp.status).toBe('succeeded');
    if (resp.status !== 'succeeded') throw new Error(JSON.stringify(resp));
    expect(resp.engine.id).toBe('sharp');
    expect(resp.fallback.used).toBe(false);
    expect((await fsp.readFile(req.workspace.outputPath)).subarray(0, 2).toString('hex')).toBe('ffd8');
  });
});
