import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { publish } from '../src/dev/publish.js';
import { tmpDir } from './helpers/fixtures.js';
import { randomUUID } from 'node:crypto';

async function seedValidated(dir: string, content: Buffer): Promise<string> {
  const p = path.join(dir, 'validated.out');
  await fsp.writeFile(p, content);
  return p;
}

describe('publish no-clobber', () => {
  it('reject: publishes once, then refuses and never overwrites', async () => {
    const dir = await tmpDir();
    const v = await seedValidated(dir, Buffer.from('new-content'));
    const first = await publish({ validatedOutputPath: v, destinationDir: dir, baseStem: 'report', extension: '.pdf', conflict: 'reject', operationId: randomUUID() });
    expect(path.basename(first.path)).toBe('report.pdf');

    // Existing destination with known bytes (simulates last-moment race).
    const target = path.join(dir, 'other.pdf');
    const original = Buffer.from('DO NOT TOUCH ME');
    await fsp.writeFile(target, original);
    const v2 = await seedValidated(dir, Buffer.from('attacker'));
    await expect(publish({ validatedOutputPath: v2, destinationDir: dir, baseStem: 'other', extension: '.pdf', conflict: 'reject', operationId: randomUUID() }))
      .rejects.toMatchObject({ code: 'FC_OUTPUT_CONFLICT' });
    expect(await fsp.readFile(target)).toEqual(original);
  });

  it('version: chooses next safe name under contention', async () => {
    const dir = await tmpDir();
    await fsp.writeFile(path.join(dir, 'f.pdf'), '0');
    await fsp.writeFile(path.join(dir, 'f (1).pdf'), '1');
    const v = await seedValidated(dir, Buffer.from('2'));
    const r = await publish({ validatedOutputPath: v, destinationDir: dir, baseStem: 'f', extension: '.pdf', conflict: 'version', operationId: randomUUID() });
    expect(path.basename(r.path)).toBe('f (2).pdf');
  });

  it('cleans up its temp file on conflict', async () => {
    const dir = await tmpDir();
    await fsp.writeFile(path.join(dir, 'x.pdf'), 'x');
    const v = await seedValidated(dir, Buffer.from('y'));
    await expect(publish({ validatedOutputPath: v, destinationDir: dir, baseStem: 'x', extension: '.pdf', conflict: 'reject', operationId: randomUUID() })).rejects.toBeTruthy();
    const left = (await fsp.readdir(dir)).filter((n) => n.startsWith('.fctmp-'));
    expect(left).toHaveLength(0);
  });

  it('published bytes hash matches content', async () => {
    const dir = await tmpDir();
    const content = Buffer.from('hash me');
    const v = await seedValidated(dir, content);
    const r = await publish({ validatedOutputPath: v, destinationDir: dir, baseStem: 'h', extension: '.md', conflict: 'reject', operationId: randomUUID() });
    const expectHash = createHash('sha256').update(content).digest('hex');
    expect(r.sha256).toBe(expectHash);
    expect(r.sizeBytes).toBe(content.length);
  });
});
