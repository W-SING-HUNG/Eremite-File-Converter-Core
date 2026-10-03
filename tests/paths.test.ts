import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { isUncPath, sanitizeFilenameStem, assertRegularLocalFile, assertOutputDirectory, longPath } from '../src/identity/paths.js';
import { tmpDir } from './helpers/fixtures.js';
import { canCreateFileSymlink } from './helpers/reparse.js';

/** Probed once: if this OS cannot produce a readable file symlink, the symlink test is SKIPPED, never passed. */
const symlinkSupported = await canCreateFileSymlink();

describe('path identity policy', () => {
  it('classifies UNC paths', () => {
    expect(isUncPath('\\\\server\\share\\f.docx')).toBe(true);
    expect(isUncPath('//server/share/f.docx')).toBe(true);
    expect(isUncPath('\\\\?\\UNC\\server\\share')).toBe(true);
    expect(isUncPath('C:\\local\\f.docx')).toBe(false);
    expect(isUncPath('\\\\?\\C:\\local')).toBe(false);
  });

  it('sanitizes filename stems while keeping unicode', () => {
    expect(sanitizeFilenameStem('报告 final ✅')).toBe('报告 final ✅');
    expect(sanitizeFilenameStem('../../evil')).toBe('evil');
    expect(sanitizeFilenameStem('a/b\\c:d*?')).toBe('abcd');
    expect(sanitizeFilenameStem('CON')).toBe('');
    expect(sanitizeFilenameStem('   ')).toBe('');
  });

  it('accepts a regular file and rejects directory', async () => {
    const dir = await tmpDir();
    const f = path.join(dir, 'a.bin');
    await fsp.writeFile(f, 'x');
    await expect(assertRegularLocalFile(f)).resolves.toBeUndefined();
    await expect(assertRegularLocalFile(dir)).rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
    await expect(assertRegularLocalFile(path.join(dir, 'missing'))).rejects.toMatchObject({ code: 'FC_INVALID_REQUEST' });
  });

  // Explicitly skipped when the OS cannot produce a readable file symlink.
  // An unexecuted assertion is NEVER counted as passed.
  it.skipIf(!symlinkSupported)('rejects symlink source', async () => {
    const dir = await tmpDir();
    const target = path.join(dir, 'target.bin');
    const link = path.join(dir, 'link.bin');
    await fsp.writeFile(target, 'x');
    await fsp.symlink(target, link, 'file');
    const st = await fsp.lstat(link);
    expect(st.isSymbolicLink()).toBe(true);
    await expect(assertRegularLocalFile(link)).rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
  });

  it('rejects UNC source without touching network', async () => {
    await expect(assertRegularLocalFile('\\\\nonexistent.invalid\\share\\f'))
      .rejects.toMatchObject({ code: 'FC_UNSAFE_INPUT_PATH' });
  });

  it('output directory must exist and be real', async () => {
    const dir = await tmpDir();
    expect(await assertOutputDirectory(dir)).toBeTruthy();
    await expect(assertOutputDirectory(path.join(dir, 'nope'))).rejects.toMatchObject({ code: 'FC_INVALID_REQUEST' });
  });

  it('longPath only extends long local paths', () => {
    expect(longPath('C:\\short')).toBe(path.resolve('C:\\short'));
  });
});
