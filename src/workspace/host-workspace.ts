/**
 * Workspace ownership (Host Contract v1.1 §3).
 *
 * The HOST is the workspace owner. The Core never creates a global staging root,
 * never sweeps system TEMP, never chooses an output directory, never versions
 * filenames and never publishes into an end-user directory. It operates ONLY
 * inside the Host-provided workspace:
 *
 *   <root>/ input/source output/result.ext work/ logs/
 *
 * This is a behavioral contract, not an OS-level sandbox claim. Every path is
 * defended against symlink / reparse point / UNC / traversal / output escape.
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import { ToolError } from '../core/errors.js';
import { isUncPath, longPath } from '../identity/paths.js';
import type { HostWorkspace } from '../core/types.js';

export interface ResolvedWorkspace {
  rootReal: string;
  inputDirReal: string;
  outputDirReal: string;
  workDir: string;
  logsDir: string;
}

async function realDir(p: string, label: string): Promise<string> {
  if (!path.isAbsolute(p)) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'must be absolute' }, 'workspace');
  if (isUncPath(p)) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'UNC rejected' }, 'workspace');
  const lst = await fsp.lstat(longPath(p)).catch(() => null);
  if (!lst) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'does not exist' }, 'workspace');
  if (lst.isSymbolicLink()) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'symlink/reparse rejected' }, 'workspace');
  if (!lst.isDirectory()) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'not a directory' }, 'workspace');
  const real = await fsp.realpath(longPath(p));
  if (isUncPath(real)) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'resolves to UNC' }, 'workspace');
  return real;
}

function assertInside(rootReal: string, targetReal: string, label: string): void {
  const rel = path.relative(rootReal, targetReal);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'escapes workspace root' }, 'workspace');
  }
}

export async function resolveHostWorkspace(ws: HostWorkspace): Promise<ResolvedWorkspace> {
  const rootLexical = path.resolve(ws.rootPath);
  const rootReal = await realDir(ws.rootPath, 'workspace.root');
  const inputDirReal = await realDir(path.dirname(ws.inputPath), 'workspace.inputDir');
  const outputDirReal = await realDir(path.dirname(ws.outputPath), 'workspace.outputDir');
  assertInside(rootReal, inputDirReal, 'workspace.inputDir');
  assertInside(rootReal, outputDirReal, 'workspace.outputDir');

  const workDir = path.resolve(rootLexical, 'work');
  const logsDir = path.resolve(rootLexical, 'logs');
  // Core creates its own scratch work/ and logs/; containment is lexical against
  // the resolved root (these dirs do not exist yet, so realpath is impossible).
  for (const [label, d] of [['workspace.workDir', workDir], ['workspace.logsDir', logsDir]] as const) {
    if (isUncPath(d)) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'UNC rejected' }, 'workspace');
    assertInside(rootLexical, d, label);
  }
  await fsp.mkdir(longPath(workDir), { recursive: true });
  await fsp.mkdir(longPath(logsDir), { recursive: true });
  // A pre-existing (or just-created) symlink/reparse dir must be rejected even
  // if mkdir no-op'd over it (covers a junction that was already there).
  for (const [label, d] of [['workspace.workDir', workDir], ['workspace.logsDir', logsDir]] as const) {
    await rejectIfReparse(d, label);
  }
  return { rootReal, inputDirReal, outputDirReal, workDir, logsDir };
}

/** Reject a symlink/reparse point (libuv reports junctions as symbolic links). */
async function rejectIfReparse(p: string, label: string): Promise<void> {
  const lst = await fsp.lstat(longPath(p)).catch(() => null);
  if (lst && lst.isSymbolicLink()) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'symlink/reparse rejected' }, 'workspace');
  }
}

/** Lstat a regular, non-symlink, non-UNC file that lives inside the allowed dir; return its real path. */
export async function assertRegularFileInside(allowedDirReal: string, p: string, label: string): Promise<string> {
  if (!path.isAbsolute(p) || isUncPath(p)) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'must be absolute, non-UNC' }, 'workspace');
  }
  const lst = await fsp.lstat(longPath(p)).catch(() => null);
  if (!lst) throw new ToolError('FC_INVALID_REQUEST', undefined, { label, reason: 'file not found' }, 'workspace');
  if (lst.isSymbolicLink()) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'symlink/reparse rejected' }, 'workspace');
  if (!lst.isFile()) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'not a regular file' }, 'workspace');
  const real = await fsp.realpath(longPath(p));
  const rel = path.relative(allowedDirReal, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label, reason: 'escapes its allowed directory' }, 'workspace');
  }
  return real;
}

/** Fixed output must be a non-existent regular-file target strictly inside the output dir. */
export async function assertFixedOutputTarget(outputDirReal: string, p: string): Promise<string> {
  if (!path.isAbsolute(p) || isUncPath(p)) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label: 'target.outputPath', reason: 'must be absolute, non-UNC' }, 'output');
  }
  const parent = path.dirname(p);
  const parentReal = await fsp.realpath(longPath(parent)).catch(() => null);
  if (!parentReal) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label: 'target.outputPath', reason: 'parent directory missing' }, 'output');
  // The parent dir itself must not be a symlink/reparse point (covers a junction).
  await rejectIfReparse(parentReal, 'target.outputPath.parent');
  const relDir = path.relative(outputDirReal, parentReal);
  if (relDir.startsWith('..') || path.isAbsolute(relDir)) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label: 'target.outputPath', reason: 'escapes output directory' }, 'output');
  }
  const existing = await fsp.lstat(longPath(p)).catch(() => null);
  if (existing) {
    if (existing.isSymbolicLink()) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { label: 'target.outputPath', reason: 'symlink target rejected' }, 'output');
    throw new ToolError('FC_OUTPUT_CONFLICT', undefined, { label: 'target.outputPath' }, 'output');
  }
  return p;
}

/**
 * Behavioral containment helper for arbitrary Host-supplied absolute paths
 * (e.g. the CLI --request / --response files). For each path: must be absolute &
 * non-UNC, must not be a symlink/reparse point, then realpath and assert it
 * stays inside rootReal (lexical relative, no '..', not absolute). This is a
 * behavioral guarantee, NOT an OS sandbox claim.
 */
export async function assertInsideWorkspace(rootReal: string, ...paths: string[]): Promise<void> {
  for (const p of paths) {
    if (!path.isAbsolute(p)) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { path: p, reason: 'must be absolute' }, 'request');
    if (isUncPath(p)) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { path: p, reason: 'UNC rejected' }, 'request');
    const lst = await fsp.lstat(longPath(p)).catch(() => null);
    if (!lst) {
      // The file may not exist yet (e.g. the response file the Core is about to
      // write). Containment is then decided by its parent directory, which must
      // already exist strictly inside the workspace.
      const parent = path.dirname(p);
      const parentLst = await fsp.lstat(longPath(parent)).catch(() => null);
      if (!parentLst) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { path: p, reason: 'parent directory does not exist' }, 'request');
      if (parentLst.isSymbolicLink()) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { path: p, reason: 'parent is symlink/reparse rejected' }, 'request');
      const parentReal = await fsp.realpath(longPath(parent));
      const rel = path.relative(rootReal, parentReal);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { path: p, reason: 'escapes workspace root' }, 'request');
      }
      continue;
    }
    if (lst.isSymbolicLink()) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { path: p, reason: 'symlink/reparse rejected' }, 'request');
    const real = await fsp.realpath(longPath(p));
    const rel = path.relative(rootReal, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { path: p, reason: 'escapes workspace root' }, 'request');
    }
  }
}

/**
 * Resolve the per-invocation scratch directory `work/<invocationId>` safely.
 *
 * Defence against a pre-created reparse/junction escape such as
 * `workspace/work/<invocationId> -> <external dir>`:
 *   1. every EXISTING ancestor from rootReal down to the target is rejected if
 *      it is a symlink/junction/reparse point;
 *   2. the directory is created;
 *   3. it is RE-LSTAT'ed and re-checked (catches a race or an existing junction
 *      that mkdir no-op'd over);
 *   4. canonical containment is re-confirmed via realpath against rootReal.
 *
 * Returns the verified absolute path. Behavioral containment, NOT an OS sandbox.
 */
export async function assertInvocationWorkDir(rootReal: string, workDir: string, invocationId: string): Promise<string> {
  if (!/^[0-9a-fA-F-]{36}$/.test(invocationId) || invocationId.includes('..')) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { reason: 'invocationId is not path-safe' }, 'workspace');
  }
  const target = path.resolve(workDir, invocationId);
  if (isUncPath(target)) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { reason: 'UNC rejected' }, 'workspace');

  // 1. existing ancestors: rootReal -> ... -> workDir -> target
  let cur = target;
  const ancestors: string[] = [];
  while (true) {
    ancestors.unshift(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    if (path.relative(rootReal, parent).startsWith('..')) break;
    cur = parent;
  }
  for (const a of ancestors) {
    const lst = await fsp.lstat(longPath(a)).catch(() => null);
    if (lst && lst.isSymbolicLink()) {
      throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { reason: 'ancestor is symlink/reparse rejected' }, 'workspace');
    }
  }

  // 2. create
  await fsp.mkdir(longPath(target), { recursive: true });

  // 3. re-verify after creation (no reparse, and still a directory)
  const after = await fsp.lstat(longPath(target)).catch(() => null);
  if (!after || after.isSymbolicLink() || !after.isDirectory()) {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { reason: 'invocation work dir is not a real directory' }, 'workspace');
  }

  // 4. canonical containment re-confirmation
  const real = await fsp.realpath(longPath(target));
  if (isUncPath(real)) throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { reason: 'resolves to UNC' }, 'workspace');
  const rel = path.relative(rootReal, real);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    throw new ToolError('FC_UNSAFE_INPUT_PATH', undefined, { reason: 'escapes workspace root' }, 'workspace');
  }
  return target;
}
