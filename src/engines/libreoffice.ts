/**
 * LibreOffice headless Office→PDF engine.
 *
 * v1.1 role: the ACTUAL PRIMARY (and only) production engine for
 * DOCX/XLSX/PPTX → PDF. There is no Microsoft Office engine in v1.1 (it remains
 * a Phase 5 design item), so fallback.used is always false.
 *
 * Safety / determinism:
 *  - argv array, shell:false; reads ONLY the canonical typed input, never sourcePath
 *  - explicit --infilter (format never guessed from extension)
 *  - per-invocation isolated -env:UserInstallation profile (correct file: URL)
 *    under workDir (never touches the user's real LibreOffice profile; --headless
 *    --norestore; no UI)
 *  - MINIMAL approved environment (never inherits the full process.env)
 *  - independent cwd; stdout/stderr captured and confined to DEV/QA diagnostics
 *  - concurrency = 1 per engine instance (serialized)
 *  - timeout; on timeout only THIS invocation's PID-rooted tree is killed
 *    (taskkill /PID /T), never `taskkill /IM soffice*` (would hit user instances)
 *
 * Filter names verified empirically on the installed LibreOffice:
 *   in:  MS Word 2007 XML / Calc MS Excel 2007 XML / Impress MS PowerPoint 2007 XML
 *   out: writer_pdf_Export / calc_pdf_Export / impress_pdf_Export
 *
 * The PDF validator only claims a STRUCTURALLY VALID PDF — never visual/pixel
 * equivalence (that belongs to the future visual golden QA phase).
 */
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { LIMITS } from '../core/constants.js';
import { ToolError } from '../core/errors.js';
import type { ConversionPair, Engine, EngineContext, EngineRunResult } from './base.js';
import { TARGET_EXT } from './base.js';

type OfficeKind = 'docx' | 'xlsx' | 'pptx';

const PAIRS: ConversionPair[] = [
  { from: 'docx', to: 'pdf' },
  { from: 'xlsx', to: 'pdf' },
  { from: 'pptx', to: 'pdf' },
];

const INFILTER: Record<OfficeKind, string> = {
  docx: 'MS Word 2007 XML',
  xlsx: 'Calc MS Excel 2007 XML',
  pptx: 'Impress MS PowerPoint 2007 XML',
};

const EXPORTER: Record<OfficeKind, string> = {
  docx: 'writer_pdf_Export',
  xlsx: 'calc_pdf_Export',
  pptx: 'impress_pdf_Export',
};

// Verified-supported PDF export options in JSON FilterData form (the legacy
// comma key=value form is silently ignored by modern LibreOffice).
function pdfFilterData(profile: 'standard' | 'high_quality'): string {
  const bool = (v: boolean) => ({ type: 'boolean', value: String(v) });
  const long = (v: number) => ({ type: 'long', value: String(v) });
  const data = profile === 'high_quality'
    ? { UseLosslessCompression: bool(true), Quality: long(100), ReduceImageResolution: bool(false) }
    : { UseLosslessCompression: bool(false), Quality: long(80), ReduceImageResolution: bool(true), MaxImageResolution: long(150) };
  return JSON.stringify(data);
}

interface LoProbe { executable: string; programDir: string; version: string; majorMinor: number; }

function candidateLaunchers(): string[] {
  const out: string[] = [];
  if (process.env.FFC_SOFFICE_PATH) out.push(process.env.FFC_SOFFICE_PATH);
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    out.push(path.join(pf, 'LibreOffice', 'program', 'soffice.com'));
    out.push(path.join(pf, 'LibreOffice', 'program', 'soffice.exe'));
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    out.push(path.join(pf86, 'LibreOffice', 'program', 'soffice.com'));
  } else {
    out.push('soffice');
  }
  return out;
}

/** Minimal approved environment: only what a headless soffice needs; no full env inheritance. */
function minimalEnv(programDir: string, scratchDir: string): NodeJS.ProcessEnv {
  mkdirSync(scratchDir, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    TMP: scratchDir, TEMP: scratchDir, TMPDIR: scratchDir,
    HOME: scratchDir,
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
  };
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot ?? 'C:\\Windows';
    env.SystemRoot = sys;
    env.SystemDrive = process.env.SystemDrive ?? 'C:';
    env.ProgramFiles = process.env.ProgramFiles;
    env['ProgramFiles(x86)'] = process.env['ProgramFiles(x86)'];
    env.ProgramData = process.env.ProgramData;
    env.PATH = [programDir, path.join(sys, 'System32'), path.join(sys, 'SysWOW64')].filter(Boolean).join(';');
  } else {
    env.PATH = `${programDir}:/usr/bin:/bin`;
  }
  return env;
}

function runProcess(
  exe: string, args: string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; childPid: number }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, shell: false, windowsHide: true, env });
    const childPid = child.pid ?? -1;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = LIMITS.capturedOutputBytes;
    child.stdout.on('data', (d) => { if (stdout.length < cap) stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (stderr.length < cap) stderr += d.toString(); });
    const killTree = () => {
      // Kill ONLY this invocation's own PID-rooted tree.
      if (process.platform === 'win32' && childPid > 0) {
        try { execFileSync('taskkill', ['/PID', String(childPid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return; } catch { /* fall through */ }
      }
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, stdout, stderr, timedOut, childPid }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut, childPid }); });
  });
}

export class LibreOfficeEngine implements Engine {
  readonly id = 'libreoffice';
  readonly type = 'subprocess-executable' as const;
  readonly optional = true;
  private probeCache: LoProbe | null | undefined;
  // concurrency = 1: serialize every conversion on this engine instance.
  private chain: Promise<unknown> = Promise.resolve();

  provides(): ConversionPair[] {
    return PAIRS.map((p) => ({ ...p }));
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  private async probe(): Promise<LoProbe | null> {
    if (this.probeCache !== undefined) return this.probeCache;
    for (const exe of candidateLaunchers()) {
      const programDir = path.dirname(exe);
      const r = await runProcess(exe, ['--version'], programDir, 20_000, minimalEnv(programDir, process.cwd()));
      const m = (r.stdout + r.stderr).match(/LibreOffice\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
      if (r.code === 0 && m) {
        const version = `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}`;
        this.probeCache = { executable: exe, programDir, version, majorMinor: Number(`${m[1]}.${m[2]}`) };
        return this.probeCache;
      }
    }
    this.probeCache = null;
    return null;
  }

  async available(): Promise<boolean> {
    const p = await this.probe();
    return !!p && (p.majorMinor >= 24 || (p.majorMinor >= 7.6 && p.majorMinor < 10));
  }

  async version(): Promise<string | null> {
    return (await this.available()) ? (await this.probe())!.version : null;
  }

  run(ctx: EngineContext): Promise<EngineRunResult> {
    return this.serialize(() => this.runSerialized(ctx));
  }

  protected async runSerialized(ctx: EngineContext): Promise<EngineRunResult> {
    const probe = await this.probe();
    if (!probe) throw new ToolError('FC_DEPENDENCY_MISSING', 'LibreOffice (soffice) not found');
    const kind = ctx.from as OfficeKind;
    if (!PAIRS.some((p) => p.from === kind && p.to === ctx.to)) {
      throw new ToolError('FC_TARGET_UNSUPPORTED');
    }
    if (ctx.profile !== 'standard' && ctx.profile !== 'high_quality') {
      throw new ToolError('FC_UNSUPPORTED_FEATURE', undefined, { profile: ctx.profile });
    }

    const profileDir = path.join(ctx.workDir, 'lo-profile');
    const profileUrl = pathToFileURL(profileDir).href; // correct file: URL (spaces/Unicode safe)
    const profileKey = ctx.profile === 'high_quality' ? 'high_quality' : 'standard';
    const filterSpec = `pdf:${EXPORTER[kind]}:${pdfFilterData(profileKey)}`;
    const expected = path.join(ctx.outDir, `input${TARGET_EXT.pdf}`);

    const args = [
      '--headless', '--norestore', '--nologo', '--nofirststartwizard',
      `-env:UserInstallation=${profileUrl}`,
      `--infilter=${INFILTER[kind]}`,
      '--convert-to', filterSpec,
      '--outdir', ctx.outDir,
      ctx.canonicalInputPath,
    ];

    const env = minimalEnv(probe.programDir, ctx.workDir);
    const timeoutMs = ctx.limits.timeoutMs;
    const r = await runProcess(probe.executable, args, ctx.workDir, timeoutMs, env);
    // Raw engine text is DEV/QA diagnostics only — never a public warning/message.
    const diagnostics = { libreoffice: { code: r.code, stdoutTail: r.stdout.slice(-400), stderrTail: r.stderr.slice(-600), timedOut: r.timedOut } };
    if (r.timedOut) throw new ToolError('FC_TIMEOUT', undefined, { timeoutMs });
    if (r.code !== 0) throw new ToolError('FC_ENGINE_FAILED', undefined, { exitCode: r.code });
    if (!existsSync(expected)) throw new ToolError('FC_ENGINE_FAILED', undefined, { reason: 'no PDF produced' });

    return {
      outputPath: expected,
      engineVersion: `libreoffice-${probe.version}`,
      parametersProfile: {
        headless: true, infilter: INFILTER[kind], exporter: EXPORTER[kind],
        pdfProfile: profileKey, isolatedProfile: true, minimalEnv: true, concurrency: 1,
      },
      warnings: [],
      diagnostics,
    };
  }
}
