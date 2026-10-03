/**
 * Scratch-directory helpers.
 *
 * v1.1: the Core owns NO global staging root and never sweeps system TEMP.
 * Scratch lives wherever the caller places it — inside the Host workspace
 * `work/` for production, or inside a DEV-only ephemeral dir for the QA CLI.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { longPath } from '../identity/paths.js';

export interface ScratchPaths {
  root: string;
  snapshotDir: string;
  engineDir: string;
  workDir: string;
  outDir: string;
}

export async function prepareScratch(root: string): Promise<ScratchPaths> {
  const snapshotDir = path.join(root, 'input');
  const engineDir = path.join(root, 'engine');
  const workDir = path.join(root, 'work');
  const outDir = path.join(root, 'out');
  for (const d of [root, snapshotDir, engineDir, workDir, outDir]) {
    await fsp.mkdir(longPath(d), { recursive: true });
  }
  return { root, snapshotDir, engineDir, workDir, outDir };
}

export async function removeScratch(root: string): Promise<void> {
  await fsp.rm(longPath(root), { recursive: true, force: true, maxRetries: 3 });
}
