import path from 'node:path';
import fsp from 'node:fs/promises';
import { ToolError } from '../core/errors.js';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/** Detect UNC paths: \\server\share, //server/share and the \\?\UNC\ long form. */
export function isUncPath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith('\\\\?\\UNC\\')) return true;
  if (p.startsWith('\\\\?\\')) return false; // extended-length local path
  return /^[\\/]{2}[^\\/?]/.test(p);
}

/** Apply the Windows extended-length prefix when useful (no-op elsewhere). */
export function longPath(p: string): string {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  if (isUncPath(p)) return p.replace(/^[\\/]{2}/, '\\\\?\\UNC\\');
  const abs = path.resolve(p);
  return abs.length >= 240 ? `\\\\?\\${abs}` : abs;
}

/**
 * v1 source must be a regular local file.
 * Rejects: missing, directory/device, symlink/junction (libuv reports both
 * as symbolic links), reparse-point-like entries, UNC.
 *
 * Known limitation: a reparse point with a non-link tag is not exposed by
 * Node lstat; tracked as Phase-1 follow-up (native tag inspection).
 */
export async function assertRegularLocalFile(sourcePath: string): Promise<void> {
  if (isUncPath(sourcePath)) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', 'UNC sources are not supported in v1', { sourcePath: basenameSafe(sourcePath) });
  }
  let st;
  try {
    st = await fsp.lstat(longPath(sourcePath));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new ToolError('FC_INVALID_REQUEST', 'source file does not exist');
    throw e;
  }
  if (st.isSymbolicLink()) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', 'symlink/reparse-point sources are not supported in v1');
  }
  if (!st.isFile()) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', 'source must be a regular local file', { isDirectory: st.isDirectory() });
  }
}

/** Output directory: must exist, be a real directory, non-UNC, and not itself a symlink/reparse point. */
export async function assertOutputDirectory(directory: string): Promise<string> {
  if (isUncPath(directory)) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', 'UNC output directories are not supported in v1');
  }
  const lst = await fsp.lstat(longPath(directory)).catch(() => null);
  if (!lst) throw new ToolError('FC_INVALID_REQUEST', 'output directory does not exist');
  if (lst.isSymbolicLink()) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', 'reparse-point output directories are not supported in v1');
  }
  if (!lst.isDirectory()) throw new ToolError('FC_INVALID_REQUEST', 'output path is not a directory');
  // realpath final check; result must still not be UNC.
  const real = await fsp.realpath(longPath(directory));
  if (isUncPath(real)) throw new ToolError('FC_UNSAFE_INPUT_PATH', 'output directory resolves to UNC');
  return real;
}

/**
 * Clean a caller-supplied output filename stem. Preserves Unicode readability
 * (Chinese / spaces / emoji / non-BMP) while removing anything that could be
 * a separator, traversal, device name or control character.
 */
export function sanitizeFilenameStem(stem: string): string {
  let s = stem.normalize('NFC').replace(ILLEGAL_FILENAME_CHARS, '').replace(/\.\./g, '.');
  s = s.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
  if (!s) return '';
  if (WINDOWS_RESERVED.test(s)) return '';
  return s.slice(0, 180);
}

export function basenameSafe(p: string): string {
  try {
    return path.basename(p);
  } catch {
    return '<unprintable-path>';
  }
}
