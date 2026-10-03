/**
 * Phase 4 — LibreOffice Office→PDF tests (v1.1: LibreOffice is the PRIMARY
 * engine, fallback.used always false; there is no Microsoft engine in v1.1).
 *
 * REAL LibreOffice (no mocks): DOCX/XLSX/PPTX → PDF through the full pipeline
 * (immutable snapshot → canonical typed input → explicit infilter → isolated
 * profile → minimal env → PDF structure validator → no-clobber publish).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createDevConverter } from '../src/dev/api.js';
import { LibreOfficeEngine } from '../src/index.js';
import { inspectPdf } from '../src/validation/pdf-inspect.js';
import { sha256File } from '../src/validation/validator.js';
import { buildDocx, buildXlsx, buildPptx } from './helpers/ooxml-fixtures.js';
import { makeZip, cfbWith } from './helpers/fixtures.js';
import { LIMITS } from '../src/core/constants.js';
import type { EngineContext } from '../src/engines/base.js';
import { conversionIdFor } from '../src/core/technical-support.js';

let tmpRoot: string;
let outDir: string;
const converter = createDevConverter();
const engine = new LibreOfficeEngine();
let sofficeBefore = 0;

function countSoffice(): number {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq soffice.bin" /FO CSV /NH', { encoding: 'utf8' });
    return out.split('\n').filter((l) => /soffice\.bin/i.test(l)).length;
  } catch {
    return 0;
  }
}

beforeAll(async () => {
  expect(await engine.available(), 'LibreOffice 7.6+ must be installed for Phase 4 suite').toBe(true);
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fc-p4-'));
  outDir = path.join(tmpRoot, 'out');
  await fsp.mkdir(outDir, { recursive: true });
  sofficeBefore = countSoffice();
}, 120000);

afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

async function stage(name: string, buf: Buffer): Promise<string> {
  const p = path.join(tmpRoot, name);
  await fsp.writeFile(p, buf);
  return p;
}

describe('LibreOffice dependency probe', () => {
  it('reports a real 7.6+ version and the three office pairs', async () => {
    const v = await engine.version();
    expect(v).toMatch(/^\d+\.\d+/);
    const pairs = engine.provides().map((p) => conversionIdFor(p.from, p.to)).sort();
    expect(pairs).toEqual(['docx-to-pdf', 'pptx-to-pdf', 'xlsx-to-pdf']);
    expect(engine.type).toBe('subprocess-executable');
    expect(engine.optional).toBe(true);
  });

  it('exposes libreoffice as the primary office-to-pdf engine in capabilities', async () => {
    const caps = await converter.getCapabilities();
    const office = caps.availableConversions.filter((c) => c.to === 'pdf');
    expect(office.map((c) => c.engine).every((e) => e === 'libreoffice')).toBe(true);
    expect(office.map((c) => c.from).sort()).toEqual(['docx', 'pptx', 'xlsx']);
  });
});

describe('Office→PDF real conversion matrix (standard profile)', () => {
  const cases = [
    { kind: 'docx', build: buildDocx, minPages: 2, label: 'A4 portrait' },
    { kind: 'xlsx', build: buildXlsx, minPages: 2, label: 'landscape multipage' },
    { kind: 'pptx', build: buildPptx, minPages: 3, label: 'slides=pages' },
  ] as const;

  for (const c of cases) {
    it(`${c.kind} -> pdf (${c.label})`, async () => {
      const src = await stage(`matrix-${c.kind}.${c.kind}`, c.build());
      const beforeHash = await sha256File(src);
      const r = await converter.convert({
        sourcePath: src, targetFormat: 'pdf', profile: 'standard',
        output: { directory: outDir, conflict: 'version' },
      });
      expect(r.status, r.status === 'failed' ? JSON.stringify(r.error) : '').toBe('succeeded');
      if (r.status !== 'succeeded') return;

      // v1.1 engine identity: libreoffice is the PRIMARY, no fallback.
      expect(r.engine.actual).toBe('libreoffice');
      expect(r.engine.actualVersion ?? '').toMatch(/^libreoffice-/);

      const buf = await fsp.readFile(r.output.path);
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const ins = inspectPdf(buf);
      expect(ins.ok, ins.errors.join('; ')).toBe(true);
      expect(ins.pageCount).toBeGreaterThanOrEqual(c.minPages);
      for (const p of ins.pages) {
        expect(p.widthPt).toBeGreaterThan(10);
        expect(p.heightPt).toBeGreaterThan(10);
      }
      expect(ins.firstPageContentBytes).toBeGreaterThan(0);
      expect(r.validation.passed).toBe(true);
      expect(await sha256File(src)).toBe(beforeHash);
      // no temp publish files left behind
      const leftovers = (await fsp.readdir(outDir)).filter((n) => n.startsWith('.fctmp'));
      expect(leftovers).toHaveLength(0);
    }, 120000);
  }
});

describe('PDF profiles', () => {
  it('high_quality also yields a valid, non-empty PDF', async () => {
    const src = await stage('hq.docx', buildDocx());
    const r = await converter.convert({
      sourcePath: src, targetFormat: 'pdf', profile: 'high_quality',
      output: { directory: outDir, conflict: 'version' },
    });
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    const ins = inspectPdf(await fsp.readFile(r.output.path));
    expect(ins.ok).toBe(true);
    expect(ins.pageCount).toBeGreaterThanOrEqual(2);
  }, 120000);

  it('unknown profile is rejected (no fabricated params)', async () => {
    const src = await stage('badprof.docx', buildDocx());
    const r = await converter.convert({
      sourcePath: src, targetFormat: 'pdf', profile: 'archival',
      output: { directory: outDir, conflict: 'version' },
    });
    expect(r.status === 'failed' && r.error.code === 'FC_UNSUPPORTED_FEATURE').toBe(true);
  });
});

describe('canonical typed input from real type (never user extension)', () => {
  it('real DOCX renamed .bin is detected as docx, warns extension mismatch, converts', async () => {
    const src = await stage('lying.bin', buildDocx());
    const r = await converter.convert({
      sourcePath: src, targetFormat: 'pdf',
      output: { directory: outDir, conflict: 'version' },
    });
    expect(r.status, r.status === 'failed' ? JSON.stringify(r.error) : '').toBe('succeeded');
    if (r.status !== 'succeeded') return;
    expect(r.detectedSourceType.kind).toBe('docx');
    expect(r.warnings.some((w) => w.code === 'FC_EXTENSION_MISMATCH')).toBe(true);
    expect(inspectPdf(await fsp.readFile(r.output.path)).ok).toBe(true);
  }, 120000);

  it('real DOCX renamed .jpg still converts via canonical input.docx', async () => {
    const src = await stage('lying.jpg', buildDocx());
    const r = await converter.convert({
      sourcePath: src, targetFormat: 'pdf',
      output: { directory: outDir, conflict: 'version' },
    });
    expect(r.status).toBe('succeeded');
  }, 120000);
});

describe('OOXML safety policy still enforced before LibreOffice runs', () => {
  it('external image relationship is blocked, no conversion', async () => {
    const src = await stage('extimg.docx', buildDocx({
      externalRel: { type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: 'http://127.0.0.1:9/x.png' },
    }));
    const r = await converter.convert({ sourcePath: src, targetFormat: 'pdf', output: { directory: outDir } });
    expect(r.status).toBe('failed');
    if (r.status === 'succeeded') return;
    expect(r.error.code).toBe('FC_EXTERNAL_REL_BLOCKED');
    expect(r.engine?.actual).toBeUndefined();
  });

  it('ordinary external hyperlink relationship is allowed and converts', async () => {
    const src = await stage('hyperlink.docx', buildDocx());
    const r = await converter.convert({ sourcePath: src, targetFormat: 'pdf', output: { directory: outDir, conflict: 'version' } });
    expect(r.status).toBe('succeeded');
  }, 120000);

  it('macro-enabled package (vbaProject.bin) rejected', async () => {
    const macro = makeZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.from('<root/>') },
      { name: 'word/vbaProject.bin', data: Buffer.from('VBA') },
    ]);
    const src = await stage('macro.docx', macro);
    const r = await converter.convert({ sourcePath: src, targetFormat: 'pdf', output: { directory: outDir } });
    expect(r.status).toBe('failed');
    if (r.status === 'succeeded') return;
    expect(r.error.code).toBe('FC_MACRO_UNSUPPORTED');
  });

  it('encrypted CFB package rejected', async () => {
    const src = await stage('enc.docx', cfbWith(['EncryptedPackage']));
    const r = await converter.convert({ sourcePath: src, targetFormat: 'pdf', output: { directory: outDir } });
    expect(r.status).toBe('failed');
    if (r.status === 'succeeded') return;
    expect(r.error.code).toBe('FC_ENCRYPTED_PROTECTED');
  });
});

describe('no-clobber publish does not regress', () => {
  it('reject: second same-name conversion -> output_conflict and first bytes unchanged', async () => {
    const src = await stage('same.docx', buildDocx());
    const r1 = await converter.convert({ sourcePath: src, targetFormat: 'pdf', output: { directory: outDir, conflict: 'reject' } });
    expect(r1.status).toBe('succeeded');
    if (r1.status !== 'succeeded') return;
    const h1 = await sha256File(r1.output.path);
    const r2 = await converter.convert({ sourcePath: src, targetFormat: 'pdf', output: { directory: outDir, conflict: 'reject' } });
    expect(r2.status).toBe('failed');
    if (r2.status === 'succeeded') return;
    expect(r2.error.code).toBe('FC_OUTPUT_CONFLICT');
    expect(await sha256File(r1.output.path)).toBe(h1);
  }, 120000);
});

describe('LibreOffice concurrency = 1 (deterministic serialization)', () => {
  it('two concurrently launched run() calls never overlap (no real conversion)', async () => {
    const intervals: Array<{ s: number; e: number }> = [];
    class Probe extends LibreOfficeEngine {
      // Bypass probe/conversion; exercise only the public run()->serialize() gate.
      protected override async runSerialized(): Promise<never> {
        const s = Date.now();
        await new Promise((r) => setTimeout(r, 80));
        intervals.push({ s, e: Date.now() });
        return undefined as never;
      }
    }
    const p = new Probe();
    const swallow = () => Promise.resolve();
    await Promise.all([p.run(undefined as unknown as EngineContext).catch(swallow), p.run(undefined as unknown as EngineContext).catch(swallow)]);
    expect(intervals).toHaveLength(2);
    const [a, b] = intervals;
    expect(a!).toBeDefined(); expect(b!).toBeDefined();
    const overlap = Math.max(0, Math.min(a!.e, b!.e) - Math.max(a!.s, b!.s));
    expect(overlap).toBe(0); // strictly serial
  });
});

describe('PDF inspector negative cases (no subprocess)', () => {
  it('rejects a non-PDF buffer', () => {
    expect(inspectPdf(Buffer.from('not a pdf')).ok).toBe(false);
  });
  it('rejects a PDF shell with zero pages', () => {
    const shell = Buffer.from('%PDF-1.7\n1 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 2 0 R>>', 'latin1');
    const ins = inspectPdf(shell);
    expect(ins.ok).toBe(false);
    expect(ins.pageCount).toBe(0);
  });
  it('timeout constant matches the frozen 180s default / 600s cap', () => {
    expect(LIMITS.timeoutMs.libreoffice).toBe(180_000);
    expect(LIMITS.timeoutMs.hardCap).toBeGreaterThanOrEqual(600_000);
  });
});

describe('process ownership / cleanup', () => {
  it('leaves no extra soffice.bin after the whole suite', async () => {
    await new Promise((res) => setTimeout(res, 1500));
    const after = countSoffice();
    expect(after).toBeLessThanOrEqual(sofficeBefore);
  });
});
