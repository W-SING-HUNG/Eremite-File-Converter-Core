import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { detectSnapshot } from '../src/detection/detect.js';
import { ooxml, cfbWith, PNG_HEAD, JPEG_HEAD, WEBP_HEAD, AVIF_HEAD, tmpDir } from './helpers/fixtures.js';

async function snapDetect(data: Buffer, basename: string) {
  const dir = await tmpDir();
  const p = path.join(dir, basename);
  await fsp.writeFile(p, data);
  return detectSnapshot(p, basename);
}

describe('real-type detection', () => {
  it('detects docx/xlsx/pptx by OOXML parts', async () => {
    expect((await snapDetect(ooxml('docx'), 'a.docx')).info.kind).toBe('docx');
    expect((await snapDetect(ooxml('xlsx'), 'a.xlsx')).info.kind).toBe('xlsx');
    expect((await snapDetect(ooxml('pptx'), 'a.pptx')).info.kind).toBe('pptx');
  });

  it('real DOCX renamed .bin/.jpg still detects docx + mismatch warning', async () => {
    const r1 = await snapDetect(ooxml('docx'), 'fake.bin');
    expect(r1.info.kind).toBe('docx');
    const r2 = await snapDetect(ooxml('docx'), 'photo.jpg');
    expect(r2.info.kind).toBe('docx');
    expect(r2.info.warnings.some((w) => w.code === 'FC_EXTENSION_MISMATCH')).toBe(true);
  });

  it('rejects vba macro document', async () => {
    const z = ooxml('docx', [{ name: 'word/vbaProject.bin' }]);
    const r = await snapDetect(z, 'a.docx');
    expect(r.rejection?.code).toBe('FC_MACRO_UNSUPPORTED');
  });

  it('rejects .docm by extension even without vba part', async () => {
    const r = await snapDetect(ooxml('docx'), 'a.docm');
    expect(r.rejection?.code).toBe('FC_MACRO_UNSUPPORTED');
  });

  it('rejects encrypted CFB package', async () => {
    const r = await snapDetect(cfbWith(['EncryptedPackage']), 'secret.docx');
    expect(r.rejection?.code).toBe('FC_ENCRYPTED_PROTECTED');
  });

  it('rejects legacy binary Office', async () => {
    const r = await snapDetect(cfbWith(['WordDocument']), 'old.doc');
    expect(r.rejection?.code).toBe('FC_SOURCE_UNSUPPORTED');
  });

  it('detects image magics', async () => {
    expect((await snapDetect(PNG_HEAD, 'a.png')).info.kind).toBe('png');
    expect((await snapDetect(JPEG_HEAD, 'a.jpg')).info.kind).toBe('jpeg');
    expect((await snapDetect(WEBP_HEAD, 'a.webp')).info.kind).toBe('webp');
    expect((await snapDetect(AVIF_HEAD, 'a.avif')).info.kind).toBe('avif');
  });

  it('detects markdown and html', async () => {
    expect((await snapDetect(Buffer.from('# title\n\ntext'), 'a.md')).info.kind).toBe('markdown');
    expect((await snapDetect(Buffer.from('<!doctype html><title>x</title>'), 'a.html')).info.kind).toBe('html');
  });

  it('rejects unknown content', async () => {
    const r = await snapDetect(Buffer.from('just some unrecognized plain text'), 'a.dat');
    expect(r.rejection?.code).toBe('FC_SOURCE_UNSUPPORTED');
  });

  it('rejects invalid-UTF8 masquerading as text as malformed', async () => {
    const r = await snapDetect(Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x90]), 'a.md');
    expect(['FC_SOURCE_CORRUPT', 'FC_SOURCE_UNSUPPORTED']).toContain(r.rejection?.code);
  });
});
