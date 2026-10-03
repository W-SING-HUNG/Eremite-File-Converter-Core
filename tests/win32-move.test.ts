import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { moveFileNoReplace } from '../src/native/win32-move.js';
import { assertSupportedRuntime } from '../src/core/runtime-guard.js';
import { tmpDir } from './helpers/fixtures.js';

const sha = async (p: string) => createHash('sha256').update(await fsp.readFile(p)).digest('hex');

describe.skipIf(process.platform !== 'win32')('MoveFileEx no-replace primitive (Windows)', () => {
  it('moves when target absent', async () => {
    const dir = await tmpDir();
    const tmp = path.join(dir, '.fctmp-x');
    const dst = path.join(dir, 'out.pdf');
    await fsp.writeFile(tmp, 'ok');
    await moveFileNoReplace(tmp, dst);
    expect(await fsp.readFile(dst, 'utf8')).toBe('ok');
    expect(await fsp.access(tmp).then(() => false, () => true)).toBe(true);
  });

  it('target exists -> output_conflict and original bytes are byte-identical', async () => {
    const dir = await tmpDir();
    const original = Buffer.from('ORIGINAL-BYTES-'.repeat(100));
    const dst = path.join(dir, 'exists.pdf');
    await fsp.writeFile(dst, original);
    const tmp = path.join(dir, '.fctmp-y');
    await fsp.writeFile(tmp, 'ATTACKER');
    await expect(moveFileNoReplace(tmp, dst)).rejects.toMatchObject({ code: 'FC_OUTPUT_CONFLICT' });
    expect(await fsp.readFile(dst)).toEqual(original);
    expect(await sha(dst)).toBe(createHash('sha256').update(original).digest('hex'));
  });

  it('race fault: 20 concurrent moves to one name -> exactly one winner, no overwrite', async () => {
    const dir = await tmpDir();
    const dst = path.join(dir, 'race.pdf');
    const temps = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const p = path.join(dir, `.fctmp-r${i}`);
        await fsp.writeFile(p, `content-${i}`.padEnd(100, 'x'));
        return p;
      }),
    );
    const results = await Promise.allSettled(temps.map((t) => moveFileNoReplace(t, dst)));
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const conflicts = results.filter((r) => r.status === 'rejected' && (r.reason as { code: string }).code === 'FC_OUTPUT_CONFLICT');
    expect(fulfilled).toHaveLength(1);
    expect(conflicts).toHaveLength(19);
    expect(await fsp.readFile(dst, 'utf8')).toMatch(/^content-\d+x+$/);
  });
});

describe('runtime guard', () => {
  it('accepts the current Node 24 runtime', () => {
    expect(() => assertSupportedRuntime()).not.toThrow();
  });
  it('rejects Node <24 with a clear message', () => {
    const original = process.versions.node;
    Object.defineProperty(process.versions, 'node', { value: '20.20.2', configurable: true });
    try {
      expect(() => assertSupportedRuntime()).toThrow(/Node 24/);
    } finally {
      Object.defineProperty(process.versions, 'node', { value: original, configurable: true });
    }
  });
});
