import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ToolError } from '../core/errors.js';
import { LIMITS } from '../core/constants.js';
import type { SourceKind } from '../core/types.js';
import { longPath } from '../identity/paths.js';
import { CANONICAL_EXT } from '../detection/detect.js';

export interface SnapshotResult {
  snapshotPath: string;
  sizeBytes: number;
  sha256: string;
}

export interface SnapshotFaults {
  /** Test seam: fires after the first streamed pass, before verification. */
  onAfterFirstPass?: () => Promise<void> | void;
}

function hashFileFromFd(fd: number, start: number, endInclusive?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const rs = createReadStream('', { fd, start, end: endInclusive, autoClose: false });
    rs.on('error', reject);
    rs.on('data', (c) => hash.update(c));
    rs.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Immutable snapshot (spec §6.1): read-only fd -> stream copy with SHA-256 ->
 * fstat identity equality -> second full source pass hash equality.
 * Engines never receive the source path, only this snapshot.
 */
export async function createSnapshot(sourcePath: string, stagingDir: string, faults: SnapshotFaults = {}): Promise<SnapshotResult> {
  await fsp.mkdir(stagingDir, { recursive: true });
  const snapshotPath = path.join(stagingDir, 'source.bin');

  const fd = await fsp.open(longPath(sourcePath), 'r');
  let copied = 0;
  try {
    const pre = await fd.stat();
    const hash = createHash('sha256');
    const ws = createWriteStream(longPath(snapshotPath), { mode: 0o444 });

    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream('', { fd, autoClose: false, highWaterMark: 1 << 20 });
      rs.on('data', (chunk: Buffer | string) => {
        const c = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        copied += c.length;
        if (copied > LIMITS.maxSourceBytesGlobal) {
          rs.destroy();
          reject(new ToolError('FC_INPUT_TOO_LARGE', `source exceeds global cap`, { limitBytes: LIMITS.maxSourceBytesGlobal }));
          return;
        }
        hash.update(c);
      });
      rs.on('error', reject);
      ws.on('error', reject);
      rs.pipe(ws);
      ws.on('finish', resolve);
    });

    const firstHash = hash.digest('hex');
    await faults.onAfterFirstPass?.();

    // Identity: same fd, size/mtime/ctime must be unchanged.
    const post = await fd.stat();
    if (post.size !== pre.size || post.mtimeMs !== pre.mtimeMs || post.ctimeMs !== pre.ctimeMs) {
      await fsp.rm(longPath(snapshotPath), { force: true });
      throw new ToolError('FC_SOURCE_CHANGED', 'source identity changed (stat)');
    }
    if (copied !== pre.size) {
      await fsp.rm(longPath(snapshotPath), { force: true });
      throw new ToolError('FC_SOURCE_CHANGED', 'source size changed during copy');
    }

    // Second full pass over the SAME fd — catches size-preserving tampering.
    const secondHash = await hashFileFromFd(fd.fd, 0, pre.size - 1);
    if (secondHash !== firstHash) {
      await fsp.rm(longPath(snapshotPath), { force: true });
      throw new ToolError('FC_SOURCE_CHANGED', 'source bytes changed during snapshot');
    }

    await fsp.chmod(longPath(snapshotPath), 0o444).catch(() => {});
    return { snapshotPath, sizeBytes: pre.size, sha256: firstHash };
  } finally {
    await fd.close().catch(() => {});
  }
}

/**
 * Canonical engine input (spec §5.2): typed copy derived ONLY from snapshot
 * bytes; extension comes from detected real type, never the user extension.
 */
export async function createCanonicalInput(snapshotPath: string, engineDir: string, realKind: SourceKind, expectedSha: string): Promise<string> {
  await fsp.mkdir(engineDir, { recursive: true });
  const canonical = path.join(engineDir, `input${CANONICAL_EXT[realKind]}`);
  await fsp.copyFile(longPath(snapshotPath), longPath(canonical));
  const hash = createHash('sha256');
  await pipeline(createReadStream(longPath(canonical)), hash);
  if (hash.digest('hex') !== expectedSha) {
    throw new ToolError('FC_INTERNAL_ERROR', 'canonical input hash differs from snapshot');
  }
  await fsp.chmod(longPath(canonical), 0o444).catch(() => {});
  return canonical;
}
