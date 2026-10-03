import { randomBytes, createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ToolError } from '../core/errors.js';
import { longPath } from '../identity/paths.js';
import { moveFileNoReplace } from '../native/win32-move.js';
import type { ConflictMode } from './types.js';

/** DEV ONLY: reject/version publish for the QA CLI. Production uses fixed-publish.ts with a Host-fixed path. */
const DEV_VERSION_CANDIDATES = 1000;

async function fsyncFile(p: string): Promise<void> {
  const fh = await fsp.open(longPath(p), 'r+');
  try { await fh.sync(); } finally { await fh.close(); }
}
async function bestEffortDirFsync(dir: string): Promise<void> {
  // Directory fsync may throw EPERM on Windows — tolerated.
  try {
    const fh = await fsp.open(longPath(dir), 'r');
    try { await fh.sync(); } finally { await fh.close(); }
  } catch { /* best effort */ }
}

async function sha256Of(p: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(longPath(p)), h);
  return h.digest('hex');
}

export interface PublishInput {
  validatedOutputPath: string;
  destinationDir: string;       // already realpath-checked
  baseStem: string;            // cleaned, no extension
  extension: string;           // includes leading dot
  conflict: ConflictMode;
  operationId: string;
}

export interface PublishResult {
  path: string;
  sizeBytes: number;
  sha256: string;
}

function candidateName(stem: string, ext: string, index: number): string {
  return index === 0 ? `${stem}${ext}` : `${stem} (${index})${ext}`;
}

/**
 * DEV-only reject/version publish. The validated output is copied to a hidden
 * SAME-DIRECTORY temp file (same volume), file-fsynced, then atomically moved to
 * the candidate with MoveFileEx WITHOUT MOVEFILE_REPLACE_EXISTING. Every version
 * candidate goes through the same no-replace primitive (never fs.rename).
 */
export async function publish(inp: PublishInput): Promise<PublishResult> {
  const { validatedOutputPath, destinationDir, baseStem, extension, conflict, operationId } = inp;
  const tmpName = `.fctmp-${operationId}-${randomBytes(4).toString('hex')}${extension}`;
  const tmpPath = path.join(destinationDir, tmpName);
  try {
    await fsp.copyFile(longPath(validatedOutputPath), longPath(tmpPath));
    await fsyncFile(tmpPath);

    const attempt = async (index: number): Promise<string> => {
      const finalPath = path.join(destinationDir, candidateName(baseStem, extension, index));
      try {
        await moveFileNoReplace(tmpPath, finalPath);
        return finalPath;
      } catch (e) {
        if (e instanceof ToolError && e.code === 'FC_OUTPUT_CONFLICT') {
          if (conflict === 'version' && index < DEV_VERSION_CANDIDATES) return attempt(index + 1);
        }
        throw e;
      }
    };

    const finalPath = await attempt(0);
    await bestEffortDirFsync(destinationDir);
    const st = await fsp.stat(longPath(finalPath));
    return { path: finalPath, sizeBytes: st.size, sha256: await sha256Of(finalPath) };
  } finally {
    await fsp.rm(longPath(tmpPath), { force: true });
  }
}
