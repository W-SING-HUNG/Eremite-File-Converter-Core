/**
 * Fixed-path publish for the Host-owned workspace (v1.1 §4).
 *
 * There is NO caller outdir, NO reject/version policy, NO filename versioning:
 * the Host designates one fixed outputPath. The validated artifact is copied to
 * a HIDDEN temp file in the SAME directory (same volume), file-fsynced, then
 * atomically placed at the exact fixed path with MoveFileEx WITHOUT
 * MOVEFILE_REPLACE_EXISTING. A same-name file appearing in the final race loses:
 * the existing bytes are never overwritten and FC_OUTPUT_CONFLICT is raised.
 */
import { randomBytes, createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { longPath } from '../identity/paths.js';
import { moveFileNoReplace } from '../native/win32-move.js';

async function fsyncFile(p: string): Promise<void> {
  const fh = await fsp.open(longPath(p), 'r+');
  try { await fh.sync(); } finally { await fh.close(); }
}
async function bestEffortDirFsync(dir: string): Promise<void> {
  try {
    const fh = await fsp.open(longPath(dir), 'r');
    try { await fh.sync(); } finally { await fh.close(); }
  } catch { /* directory fsync may EPERM on Windows */ }
}
async function sha256Of(p: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(longPath(p)), h);
  return h.digest('hex');
}

export interface FixedPublishInput {
  validatedOutputPath: string;
  fixedOutputPath: string;
}

export interface FixedPublishResult {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export async function publishFixed(inp: FixedPublishInput): Promise<FixedPublishResult> {
  const { validatedOutputPath, fixedOutputPath } = inp;
  const dir = path.dirname(fixedOutputPath);
  const tmpName = `.fctmp-work-${randomBytes(6).toString('hex')}${path.extname(fixedOutputPath)}`;
  const tmpPath = path.join(dir, tmpName);
  try {
    await fsp.copyFile(longPath(validatedOutputPath), longPath(tmpPath));
    await fsyncFile(tmpPath);
    // Race-proof no-replace placement at the exact fixed name.
    await moveFileNoReplace(tmpPath, fixedOutputPath);
    await bestEffortDirFsync(dir);
    const st = await fsp.stat(longPath(fixedOutputPath));
    return { path: fixedOutputPath, sizeBytes: st.size, sha256: await sha256Of(fixedOutputPath) };
  } finally {
    await fsp.rm(longPath(tmpPath), { force: true });
  }
}
