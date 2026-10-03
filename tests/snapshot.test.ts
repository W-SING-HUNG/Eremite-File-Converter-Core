import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createSnapshot, createCanonicalInput } from '../src/snapshot/snapshot.js';
import { tmpDir } from './helpers/fixtures.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('immutable snapshot', () => {
  it('known vector: sha256("abc")', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'abc.txt');
    await fsp.writeFile(src, 'abc');
    const r = await createSnapshot(src, path.join(dir, 's'));
    expect(r.sha256).toBe(sha(Buffer.from('abc')));
    expect(r.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(r.sizeBytes).toBe(3);
  });

  it('never modifies the source file', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, '中文 空格 ✅.bin');
    const data = Buffer.alloc(1234, 7);
    await fsp.writeFile(src, data);
    const before = await fsp.stat(src);
    await createSnapshot(src, path.join(dir, 's'));
    const after = await fsp.stat(src);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('TOCTOU: append during snapshot -> source_changed_during_snapshot', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'race.bin');
    await fsp.writeFile(src, Buffer.alloc(100_000, 1));
    await expect(
      createSnapshot(src, path.join(dir, 's'), {
        onAfterFirstPass: async () => { await fsp.appendFile(src, Buffer.from('changed')); },
      }),
    ).rejects.toMatchObject({ code: 'FC_SOURCE_CHANGED' });
  });

  it('TOCTOU: same-size overwrite during snapshot is caught by second pass', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'race2.bin');
    await fsp.writeFile(src, Buffer.alloc(100_000, 1));
    await expect(
      createSnapshot(src, path.join(dir, 's2'), {
        onAfterFirstPass: async () => {
          const fd = await fsp.open(src, 'r+');
          await fd.write(Buffer.from([255]), 0, 1, 0);
          await fd.close();
        },
      }),
    ).rejects.toMatchObject({ code: 'FC_SOURCE_CHANGED' });
  });

  it('canonical input uses real-type extension and identical bytes', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'disguised.jpg');
    const data = Buffer.from('# hi\n');
    await fsp.writeFile(src, data);
    const snap = await createSnapshot(src, path.join(dir, 's'));
    const canonical = await createCanonicalInput(snap.snapshotPath, path.join(dir, 'e'), 'markdown', snap.sha256);
    expect(path.basename(canonical)).toBe('input.md');
    expect(await fsp.readFile(canonical)).toEqual(data);
  });
});
