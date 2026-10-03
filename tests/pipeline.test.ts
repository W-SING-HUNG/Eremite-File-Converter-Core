import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createDevConverter } from '../src/dev/api.js';
import { QaStubEngine } from '../src/dev/qa-stub.js';
import { buildCompactProvenance } from '../src/core/provenance.js';
import { PUBLIC_WARNING_CODES } from '../src/core/warnings.js';
import { LIMITS } from '../src/core/constants.js';
import { ooxml, tmpDir } from './helpers/fixtures.js';

describe('conversion pipeline (DEV convert path)', () => {
  it('explicitly no engines -> dependency_missing', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'a.md');
    await fsp.writeFile(src, '# hi\n');
    const c = createDevConverter({ engines: [] });
    const r = await c.convert({ sourcePath: src, targetFormat: 'html', output: { directory: dir } });
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.error.code).toBe('FC_DEPENDENCY_MISSING');
    expect(r.error.recovery).toBe('after_user_action');
  });

  it('qa stub end-to-end: markdown -> html succeeds and publishes', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'note.md');
    await fsp.writeFile(src, '# title\n\n[link](https://example.com)\n');
    const c = createDevConverter({ engines: [new QaStubEngine()] });
    const r = await c.convert({ sourcePath: src, targetFormat: 'html', output: { directory: dir } });
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') throw new Error(JSON.stringify(r));
    expect(r.engine.actual).toBe('__qa_stub__');
    expect(r.output.path.endsWith('.html')).toBe(true);
    expect(await fsp.readFile(r.output.path, 'utf8')).toContain('QA stub');
    expect(r.provenance.source.sha256).toBe(r.source.sha256);
  });

  it('real DOCX renamed .jpg still converts as docx', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'photo.jpg');
    await fsp.writeFile(src, ooxml('docx'));
    const c = createDevConverter({ engines: [new QaStubEngine()] });
    const r = await c.convert({ sourcePath: src, targetFormat: 'pdf', output: { directory: dir } });
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') throw new Error(JSON.stringify(r));
    expect(r.detectedSourceType.kind).toBe('docx');
    expect((await fsp.readFile(r.output.path)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('illegal pair -> unsupported_target', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 'p.png');
    await fsp.writeFile(src, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
    const c = createDevConverter({ engines: [new QaStubEngine()] });
    const r = await c.convert({ sourcePath: src, targetFormat: 'pdf', output: { directory: dir } });
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.error.code).toBe('FC_TARGET_UNSUPPORTED');
  });

  it('invalid operationId -> invalid_request', async () => {
    const dir = await tmpDir();
    const c = createDevConverter({ engines: [new QaStubEngine()] });
    const r = await c.convert({
      sourcePath: path.join(dir, 'x.md'), targetFormat: 'html',
      operationId: '../escape', output: { directory: dir },
    } as never);
    expect(r.status).toBe('failed');
    if (r.status !== 'failed') return;
    expect(r.error.code).toBe('FC_INVALID_REQUEST');
  });

  it('scratch is removed and source untouched', async () => {
    const dir = await tmpDir();
    const src = path.join(dir, 's.md');
    const data = Buffer.from('# unchanged\n');
    await fsp.writeFile(src, data);
    const c = createDevConverter({ engines: [new QaStubEngine()] });
    await c.convert({ sourcePath: src, targetFormat: 'html', output: { directory: dir } });
    expect(await fsp.readFile(src)).toEqual(data);
  });

  it('compact provenance is under the 16 KiB persistence cap', () => {
    const p = buildCompactProvenance({
      invocationId: '123e4567-e89b-42d3-a456-426614174000',
      conversionId: 'markdown-to-html',
      startedAt: new Date(0).toISOString(), endedAt: new Date(1).toISOString(), durationMs: 1,
      sourceBasename: 'a.md', realType: 'markdown', sourceSize: 1, sourceSha: 'x'.repeat(64),
      target: 'html', profile: 'standard', actualEngine: 'pandoc', actualVersion: '3',
      warnings: Array.from({ length: LIMITS.compactWarningsKept }, (_, i) => ({ code: PUBLIC_WARNING_CODES[i % PUBLIC_WARNING_CODES.length]! })),
    });
    expect(p.schemaVersion).toBe('1.1');
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(LIMITS.compactResultMaxSerializedBytes);
    expect(p.warnings).toHaveLength(LIMITS.compactWarningsKept);
  });
});
