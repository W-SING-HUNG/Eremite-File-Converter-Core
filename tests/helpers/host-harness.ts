import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createFileConverter } from '../../src/index.js';
import { resolveHostWorkspace } from '../../src/workspace/host-workspace.js';
import type { HostInvocationRequest, HostInvocationResponse, SourceKind, TargetFormat, HostLimits } from '../../src/core/types.js';
import { fmt } from '../../src/core/formats.js';
import { lookupTechnical } from '../../src/core/technical-support.js';

export interface HostHarness {
  root: string;
  inputDir: string;
  outputDir: string;
  workDir: string;
  logsDir: string;
  writeSource(name: string, data: Buffer | string): Promise<string>;
  sourceHash(p: string): Promise<string>;
  buildRequest(opts: {
    sourcePath: string;
    conversionId: string;
    outputName: string;
    engine?: 'sharp' | 'pandoc' | 'libreoffice';
    limits?: HostLimits;
    invocationId?: string;
    /** Override the Host-supplied hash/size to simulate mismatch. */
    tamper?: { sha256?: string; byteSize?: number };
  }): Promise<HostInvocationRequest>;
  run(req: HostInvocationRequest): Promise<HostInvocationResponse>;
  cleanup(): Promise<void>;
}

async function sha256(p: string): Promise<string> {
  const b = await fsp.readFile(p);
  return createHash('sha256').update(b).digest('hex');
}

const DEFAULT_LIMITS: HostLimits = {
  maxInputBytes: 50 * 1024 * 1024,
  maxOutputBytes: 50 * 1024 * 1024,
  maxWorkspaceBytes: 200 * 1024 * 1024,
  timeoutMs: 60_000,
};

export async function makeHostHarness(): Promise<HostHarness> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'fc-host-'));
  const inputDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  const workDir = path.join(root, 'work');
  const logsDir = path.join(root, 'logs');
  for (const d of [inputDir, outputDir, workDir, logsDir]) await fsp.mkdir(d, { recursive: true });
  const converter = createFileConverter();

  return {
    root, inputDir, outputDir, workDir, logsDir,
    async writeSource(name, data) {
      const p = path.join(inputDir, name);
      await fsp.writeFile(p, data);
      return p;
    },
    sourceHash: sha256,
    async buildRequest(opts) {
      const st = await fsp.stat(opts.sourcePath);
      const tech = lookupTechnical(opts.conversionId);
      // conversionId is an OPAQUE stable identifier: source/target are resolved
      // from the Core registry, never derived by splitting the string.
      const from = tech?.from as SourceKind;
      const to = tech?.to as TargetFormat;
      const realHash = await sha256(opts.sourcePath);
      return {
        kind: 'request',
        contractVersion: 1,
        invocationId: opts.invocationId ?? '123e4567-e89b-42d3-a456-426614174000',
        workspace: {
          rootPath: root,
          inputPath: opts.sourcePath,
          outputPath: path.join(outputDir, opts.outputName),
        },
        source: {
          displayName: path.basename(opts.sourcePath),
          declaredMediaType: fmt(from).mediaType,
          byteSize: opts.tamper?.byteSize ?? st.size,
          sha256: opts.tamper?.sha256 ?? realHash,
        },
        conversion: {
          conversionId: opts.conversionId,
          target: { formatId: to, mediaType: fmt(to).mediaType, extension: fmt(to).extension },
          enginePlan: { primaryEngineId: opts.engine ?? tech!.engine, fallbackEngineId: null },
        },
        limits: opts.limits ?? DEFAULT_LIMITS,
      };
    },
    async run(req) {
      const ws = await resolveHostWorkspace(req.workspace);
      return converter.runHostInvocation(req, ws);
    },
    async cleanup() { await fsp.rm(root, { recursive: true, force: true }).catch(() => {}); },
  };
}
