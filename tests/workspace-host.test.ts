import { describe, it, expect, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import {
  resolveHostWorkspace, assertRegularFileInside, assertFixedOutputTarget, assertInvocationWorkDir,
} from '../src/workspace/host-workspace.js';
import { makeHostHarness, type HostHarness } from './helpers/host-harness.js';
import { canCreateFileSymlink, canCreateJunction } from './helpers/reparse.js';

/** Probed once: unexecuted reparse assertions must be SKIPPED, never passed. */
const symlinkSupported = await canCreateFileSymlink();
const junctionSupported = await canCreateJunction();

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

describe('Host workspace ownership', () => {
  let h: HostHarness | null = null;
  afterEach(async () => { if (h) { await h.cleanup(); h = null; } });

  it('rejects a source file that escapes the input directory', async () => {
    h = await makeHostHarness();
    const ws = await resolveHostWorkspace({ rootPath: h.root, inputPath: path.join(h.inputDir, 'in.bin'), outputPath: path.join(h.outputDir, 'out.bin') });
    const outside = path.join(h.root, 'secret.bin');
    await fsp.writeFile(outside, 'x');
    await expect(assertRegularFileInside(ws.inputDirReal, outside, 'source')).rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
  });

  it.skipIf(!symlinkSupported)('rejects a symlink source inside the input dir', async () => {
    h = await makeHostHarness();
    const ws = await resolveHostWorkspace({ rootPath: h.root, inputPath: path.join(h.inputDir, 'in.bin'), outputPath: path.join(h.outputDir, 'out.bin') });
    const real = path.join(h.inputDir, 'real.png');
    await fsp.writeFile(real, 'x');
    const link = path.join(h.inputDir, 'source');
    await fsp.symlink(real, link, 'file');
    const st = await fsp.lstat(link);
    expect(st.isSymbolicLink()).toBe(true);
    await expect(assertRegularFileInside(ws.inputDirReal, link, 'source')).rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
  });

  // ── Ancestor reparse-point (junction) escape — the paths the Host does not supply directly ──

  it.skipIf(!junctionSupported)('A. rejects workspace/work pre-created as an external junction', async () => {
    h = await makeHostHarness();
    const outside = path.join(h.root, '..', `outside-work-${Date.now()}`);
    await fsp.mkdir(outside, { recursive: true });
    try {
      await fsp.rm(path.join(h.root, 'work'), { recursive: true, force: true });
      await fsp.symlink(outside, path.join(h.root, 'work'), 'junction');
      await expect(resolveHostWorkspace({ rootPath: h.root, inputPath: path.join(h.inputDir, 'in.bin'), outputPath: path.join(h.outputDir, 'out.bin') }))
        .rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
    } finally {
      await fsp.rm(path.join(h.root, 'work'), { recursive: true, force: true }).catch(() => {});
      await fsp.rm(outside, { recursive: true, force: true }).catch(() => {});
    }
  });

  it.skipIf(!junctionSupported)('B. rejects workspace/logs pre-created as an external junction', async () => {
    h = await makeHostHarness();
    const outside = path.join(h.root, '..', `outside-logs-${Date.now()}`);
    await fsp.mkdir(outside, { recursive: true });
    try {
      await fsp.rm(path.join(h.root, 'logs'), { recursive: true, force: true });
      await fsp.symlink(outside, path.join(h.root, 'logs'), 'junction');
      await expect(resolveHostWorkspace({ rootPath: h.root, inputPath: path.join(h.inputDir, 'in.bin'), outputPath: path.join(h.outputDir, 'out.bin') }))
        .rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
    } finally {
      await fsp.rm(path.join(h.root, 'logs'), { recursive: true, force: true }).catch(() => {});
      await fsp.rm(outside, { recursive: true, force: true }).catch(() => {});
    }
  });

  it.skipIf(!junctionSupported)('C. rejects an output parent that is an external junction', async () => {
    h = await makeHostHarness();
    const outside = path.join(h.root, '..', `outside-out-${Date.now()}`);
    await fsp.mkdir(outside, { recursive: true });
    const junctionDir = path.join(h.root, 'out-junction');
    try {
      await fsp.symlink(outside, junctionDir, 'junction');
      const ws = await resolveHostWorkspace({ rootPath: h.root, inputPath: path.join(h.inputDir, 'in.bin'), outputPath: path.join(h.outputDir, 'out.bin') });
      // Publishing through a junctioned parent must never escape the workspace.
      await expect(assertFixedOutputTarget(ws.outputDirReal, path.join(junctionDir, 'result.jpg')))
        .rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
    } finally {
      await fsp.rm(junctionDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rm(outside, { recursive: true, force: true }).catch(() => {});
    }
  });

  it.skipIf(!junctionSupported)('D. rejects work/<uuidv7> pre-created as an external junction', async () => {
    h = await makeHostHarness();
    const ws = await resolveHostWorkspace({ rootPath: h.root, inputPath: path.join(h.inputDir, 'in.bin'), outputPath: path.join(h.outputDir, 'out.bin') });
    const outside = path.join(h.root, '..', `outside-scratch-${Date.now()}`);
    await fsp.mkdir(outside, { recursive: true });
    const id = uuidV7();
    const scratch = path.join(h.workDir, id);
    try {
      await fsp.symlink(outside, scratch, 'junction');
      expect((await fsp.lstat(scratch)).isSymbolicLink()).toBe(true);
      await expect(assertInvocationWorkDir(ws.rootReal, ws.workDir, id))
        .rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
      // the escape target must receive no scratch writes at all
      expect(await fsp.readdir(outside)).toEqual([]);
    } finally {
      await fsp.rmdir(scratch).catch(() => {});
      await fsp.rm(outside, { recursive: true, force: true }).catch(() => {});
    }
  });

  it.skipIf(!junctionSupported)('E. full invocation through a junctioned work/<uuidv7> fails and leaks nothing', async () => {
    h = await makeHostHarness();
    const outside = path.join(h.root, '..', `outside-invoke-${Date.now()}`);
    await fsp.mkdir(outside, { recursive: true });
    const id = uuidV7();
    const scratch = path.join(h.workDir, id);
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'blue' } }).png().toBuffer();
    const src = await h.writeSource('source', png);
    try {
      await fsp.symlink(outside, scratch, 'junction');
      const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'esc.jpg', invocationId: id });
      const resp = await h.run(req);
      expect(resp.status).toBe('failed');
      if (resp.status !== 'failed') throw new Error(JSON.stringify(resp));
      expect(resp.errors[0]?.code).toBe('FC_UNSAFE_INPUT_PATH');
      // nothing was written through the junction, and nothing was published
      expect(await fsp.readdir(outside)).toEqual([]);
      expect(await fsp.access(path.join(h.outputDir, 'esc.jpg')).then(() => true).catch(() => false)).toBe(false);
    } finally {
      await fsp.rmdir(scratch).catch(() => {});
      await fsp.rm(outside, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('rejects UNC source without touching the network', async () => {
    h = await makeHostHarness();
    const ws = await resolveHostWorkspace({ rootPath: h.root, inputPath: path.join(h.inputDir, 'in.bin'), outputPath: path.join(h.outputDir, 'out.bin') });
    await expect(assertRegularFileInside(ws.inputDirReal, '\\\\nonexistent.invalid\\share\\f', 'source'))
      .rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
  });

  it('rejects a fixed output path that escapes the output directory (traversal)', async () => {
    h = await makeHostHarness();
    const ws = await resolveHostWorkspace({ rootPath: h.root, inputPath: path.join(h.inputDir, 'in.bin'), outputPath: path.join(h.outputDir, 'out.bin') });
    await expect(assertFixedOutputTarget(ws.outputDirReal, path.join(h.root, 'escape.jpg')))
      .rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
  });

  it('pre-existing fixed output target -> FC_OUTPUT_CONFLICT (no overwrite)', async () => {
    h = await makeHostHarness();
    const ws = await resolveHostWorkspace({ rootPath: h.root, inputPath: path.join(h.inputDir, 'in.bin'), outputPath: path.join(h.outputDir, 'out.bin') });
    const target = path.join(h.outputDir, 'result.jpg');
    await fsp.writeFile(target, 'original');
    await expect(assertFixedOutputTarget(ws.outputDirReal, target)).rejects.toMatchObject({ code: 'FC_OUTPUT_CONFLICT' });
    expect(await fsp.readFile(target, 'utf8')).toBe('original');
  });

  it('full host invocation refuses to overwrite an existing fixed output', async () => {
    h = await makeHostHarness();
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).png().toBuffer();
    const src = await h.writeSource('source', png);
    const target = path.join(h.outputDir, 'fixed.jpg');
    await fsp.writeFile(target, 'keep-me');
    const req = await h.buildRequest({ sourcePath: src, conversionId: 'png-to-jpeg', outputName: 'fixed.jpg' });
    const resp = await h.run(req);
    expect(resp.status).toBe('failed');
    if (resp.status !== 'failed') throw new Error('x');
    expect(resp.errors[0]?.code).toBe('FC_OUTPUT_CONFLICT');
    expect(await fsp.readFile(target, 'utf8')).toBe('keep-me');
  });
});
