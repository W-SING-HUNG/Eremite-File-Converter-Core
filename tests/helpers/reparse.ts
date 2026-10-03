/**
 * Reparse-point capability detection.
 *
 * Tests must never count an unexecuted assertion as "passed". On some Windows
 * setups a symlink can be created but not read back (lstat -> ENOENT), and
 * creating file symlinks at all can be privilege-gated. Tests therefore probe
 * capability up front and use `it.skipIf(...)` so the run summary honestly
 * reports SKIPPED instead of a false green.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fc-reparse-'));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** True only when a FILE symlink can be created AND lstat reports a symbolic link. */
export async function canCreateFileSymlink(): Promise<boolean> {
  return withTemp(async (dir) => {
    const target = path.join(dir, 'target.bin');
    const link = path.join(dir, 'link.bin');
    try {
      await fsp.writeFile(target, 'x');
      await fsp.symlink(target, link, 'file');
      const st = await fsp.lstat(link);
      return st.isSymbolicLink();
    } catch {
      return false;
    }
  });
}

/** True only when a DIRECTORY junction can be created and lstat reports a link (Windows). */
export async function canCreateJunction(): Promise<boolean> {
  return withTemp(async (dir) => {
    const target = path.join(dir, 'target-dir');
    const link = path.join(dir, 'link-dir');
    try {
      await fsp.mkdir(target);
      await fsp.symlink(target, link, 'junction');
      const st = await fsp.lstat(link);
      return st.isSymbolicLink();
    } catch {
      return false;
    }
  });
}
