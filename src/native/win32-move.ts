import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ToolError } from '../core/errors.js';
import { longPath } from '../identity/paths.js';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const helperName = process.platform === 'win32' ? 'fc-movefile.exe' : 'fc-movefile';

/**
 * The helper is a BUILD artifact: build-native compiles FcMoveFile.cs straight
 * into dist/native/bin. No generated copy is kept in the src tree. Resolve it
 * from (1) an explicit override, (2) alongside the compiled module (dist), or
 * (3) the repo-root dist build when running TS sources under vitest/tsx.
 */
function resolveHelper(): string {
  const candidates = [
    process.env.FC_MOVEFILE_HELPER,
    path.join(here, 'bin', helperName),
    path.join(here, '..', '..', 'dist', 'native', 'bin', helperName),
    path.join(here, '..', 'native', 'bin', helperName),
  ].filter((c): c is string => !!c);
  const found = candidates.find((c) => existsSync(longPath(c)));
  if (!found) throw new ToolError('FC_INTERNAL_ERROR', 'MoveFileEx helper not built; run the native build step');
  return found;
}

/**
 * Minimal, single-purpose Win32 adapter boundary (frozen contract §6.3):
 * the production no-clobber primitive on Windows is
 *
 *   MoveFileExW(src, dst, 0)   // MOVEFILE_REPLACE_EXISTING deliberately unset
 *
 * via our own ~4.5 KB helper (src/native/win32/FcMoveFile.cs, built with the
 * in-box .NET Framework csc — no SDK, no native framework, no dependency).
 *
 * fs.rename is forbidden (libuv may replace an existing destination).
 * fs.link is NOT a production primitive on Windows.
 */
export async function moveFileNoReplace(src: string, dst: string): Promise<void> {
  if (process.platform === 'win32') {
    const HELPER = resolveHelper();
    let stderr = '';
    try {
      const r = await execFileAsync(HELPER, [src, dst], {
        windowsHide: true,
        timeout: 30_000,
        // Never through a shell; argv array only.
        shell: false,
      });
      stderr = String(r.stderr ?? '').trim();
    } catch (e) {
      const code = (e as { code?: number | string; stderr?: string }).code;
      stderr = String((e as { stderr?: Buffer | string }).stderr ?? '').trim();
      if (code === 3 || stderr === 'FILE_EXISTS') {
        throw new ToolError('FC_OUTPUT_CONFLICT', 'destination already exists (MoveFileEx no-replace)');
      }
      throw new ToolError('FC_INTERNAL_ERROR', 'MoveFileEx helper failed');
    }
    if (stderr === 'FILE_EXISTS') {
      throw new ToolError('FC_OUTPUT_CONFLICT', 'destination already exists (MoveFileEx no-replace)');
    }
    return;
  }

  // Portable-architecture path for non-Windows development only. This is NOT
  // the Windows v1 production primitive; v1 official platform stays Windows.
  try {
    await fsp.link(longPath(src), longPath(dst));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new ToolError('FC_OUTPUT_CONFLICT', 'destination already exists');
    throw new ToolError('FC_INTERNAL_ERROR', 'no-clobber move unsupported');
  }
  await fsp.rm(longPath(src), { force: true });
}
