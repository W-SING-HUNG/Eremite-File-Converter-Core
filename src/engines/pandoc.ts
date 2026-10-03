/**
 * Pandoc structured-document engine.
 *
 * Pairs: markdown→html, html→markdown, markdown→docx. Fidelity class:
 * semantic-standalone (never pixel-level).
 *
 * Security:
 *  - argv array only, never a shell string, shell:false
 *  - --sandbox always on; no filters / lua-filters / self-contained /
 *    embed-resources / pdf-engine
 *  - MINIMAL approved environment (never inherits full process.env)
 *  - independent cwd = workDir; reads ONLY the canonical input, never sourcePath
 *  - standalone resource preflight runs BEFORE pandoc (incl. markdown raw-HTML
 *    script/link/style/base; --sandbox is defense in depth)
 *  - timeout, stdout/stderr captured; raw Pandoc text goes to DEV/QA diagnostics
 *    only, never into a public warning/message
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { LIMITS } from '../core/constants.js';
import { ToolError } from '../core/errors.js';
import { publicWarning } from '../core/warnings.js';
import type { Warning } from '../core/types.js';
import type { ConversionPair, Engine, EngineContext, EngineRunResult } from './base.js';
import { TARGET_EXT } from './base.js';
import { longPath } from '../identity/paths.js';
import { assertStandalone, type StructuredKind } from './structured-resources.js';

const PAIRS: ConversionPair[] = [
  { from: 'markdown', to: 'html' },
  { from: 'html', to: 'markdown' },
  { from: 'markdown', to: 'docx' },
];

interface PandocProbe { executable: string; version: string; sandboxSupported: boolean; }

function minimalEnv(scratchDir: string): NodeJS.ProcessEnv {
  mkdirSync(scratchDir, { recursive: true });
  const env: NodeJS.ProcessEnv = { TMP: scratchDir, TEMP: scratchDir, TMPDIR: scratchDir, HOME: scratchDir, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot ?? 'C:\\Windows';
    env.SystemRoot = sys;
    env.SystemDrive = process.env.SystemDrive ?? 'C:';
    env.PATH = [path.join(sys, 'System32'), path.join(sys, 'SysWOW64'), process.env.PATH ?? ''].join(';');
  } else {
    env.PATH = '/usr/bin:/bin';
  }
  return env;
}

function candidateExecutables(): string[] {
  const out: string[] = [];
  if (process.env.FFC_PANDOC_PATH) out.push(process.env.FFC_PANDOC_PATH);
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, 'Pandoc', 'pandoc.exe'));
    out.push(path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Pandoc', 'pandoc.exe'));
    out.push('pandoc.exe');
  } else {
    out.push('pandoc');
  }
  return out;
}

function runProcess(
  exe: string, args: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, shell: false, windowsHide: true, env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = LIMITS.capturedOutputBytes;
    child.stdout.on('data', (d) => { if (stdout.length < cap) stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (stderr.length < cap) stderr += d.toString(); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, stdout, stderr, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

export class PandocEngine implements Engine {
  readonly id = 'pandoc';
  readonly type = 'subprocess-executable' as const;
  readonly optional = true;

  private probeCache: PandocProbe | null | undefined;

  provides(): ConversionPair[] {
    return PAIRS.map((p) => ({ ...p }));
  }

  private async probe(): Promise<PandocProbe | null> {
    if (this.probeCache !== undefined) return this.probeCache;
    for (const exe of candidateExecutables()) {
      const r = await runProcess(exe, ['--version'], process.cwd(), 10_000, minimalEnv(process.cwd()));
      if (r.code !== 0) continue;
      const firstLine = r.stdout.split(/\r?\n/)[0] ?? '';
      const vm = firstLine.match(/pandoc\s+(\d+\.\d+(?:\.\d+)?)/i);
      if (!vm) continue;
      const help = await runProcess(exe, ['--help'], process.cwd(), 10_000, minimalEnv(process.cwd()));
      const sandboxSupported = /--sandbox/.test(help.stdout);
      this.probeCache = { executable: exe, version: vm[1]!, sandboxSupported };
      return this.probeCache;
    }
    this.probeCache = null;
    return null;
  }

  async available(): Promise<boolean> {
    const p = await this.probe();
    return !!p && p.sandboxSupported;
  }

  async version(): Promise<string | null> {
    const p = await this.probe();
    return p?.sandboxSupported ? p.version : null;
  }

  async run(ctx: EngineContext): Promise<EngineRunResult> {
    const probe = await this.probe();
    if (!probe) throw new ToolError('FC_DEPENDENCY_MISSING');
    if (!probe.sandboxSupported) throw new ToolError('FC_DEPENDENCY_MISSING', undefined, { reason: 'pandoc lacks --sandbox (need 3.1+)' });

    // Standalone resource preflight on the CANONICAL input (never sourcePath).
    const sourceKind: StructuredKind = ctx.from === 'html' ? 'html' : 'markdown';
    const inputText = await fsp.readFile(longPath(ctx.canonicalInputPath), 'utf8');
    assertStandalone(sourceKind, inputText);

    const reader = ctx.from === 'html' ? 'html' : 'gfm-raw_html';
    const writer = ctx.to === 'html' ? 'html' : ctx.to === 'docx' ? 'docx' : 'gfm-raw_html';
    const outName = `output${TARGET_EXT[ctx.to]}`;
    const outPath = path.join(ctx.outDir, outName);

    const args = ['--sandbox', '-f', reader, '-t', writer, '-o', outPath, ctx.canonicalInputPath];
    const env = minimalEnv(ctx.workDir);
    const timeoutMs = ctx.limits.timeoutMs;
    const r = await runProcess(probe.executable, args, ctx.workDir, timeoutMs, env);
    const diagnostics = { pandoc: { code: r.code, stderrTail: r.stderr.slice(-600), timedOut: r.timedOut } };
    if (r.timedOut) throw new ToolError('FC_TIMEOUT', undefined, { timeoutMs });
    if (r.code !== 0) throw new ToolError('FC_ENGINE_FAILED', undefined, { exitCode: r.code });

    const warnings: Warning[] = [];
    if (/\[WARNING\]/.test(r.stderr)) warnings.push(publicWarning('FC_OUTPUT_NORMALIZED')); // raw text -> diagnostics only

    return {
      outputPath: outPath,
      engineVersion: `pandoc-${probe.version}`,
      parametersProfile: { sandbox: true, reader, writer, embedResources: false, filters: false, minimalEnv: true },
      warnings,
      diagnostics,
    };
  }
}
