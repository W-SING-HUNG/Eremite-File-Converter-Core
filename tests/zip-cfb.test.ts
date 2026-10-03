import { describe, it, expect } from 'vitest';
import { readZipEntries, assessZipSafety } from '../src/detection/zip-container.js';
import { isEncryptedPackage } from '../src/detection/cfb.js';
import { makeZip, ooxml, cfbWith } from './helpers/fixtures.js';
import { LIMITS } from '../src/core/constants.js';

function safetyOf(z: Buffer) {
  return assessZipSafety(readZipEntries(z), LIMITS.archive);
}

describe('zip container validation', () => {
  it('reads central directory entries', () => {
    const names = readZipEntries(ooxml('docx')).map((e) => e.name);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('word/document.xml');
  });

  it('flags path traversal entries unsafe', () => {
    const z = makeZip([{ name: '../evil.bin', data: Buffer.from('x') }]);
    const r = safetyOf(z);
    expect(r.unsafe).toBe(true);
    expect(r.reason).toBe('unsafe-path');
  });

  it('flags drive-absolute entries unsafe', () => {
    const z = makeZip([{ name: 'C:/Windows/x', data: Buffer.from('x') }]);
    expect(safetyOf(z).reason).toBe('unsafe-path');
  });

  it('flags archive exceeding expanded-size cap', () => {
    const z = makeZip([
      { name: 'a', data: Buffer.from('x'), uncompressedSizeOverride: 180 * 1024 * 1024 },
      { name: 'b', data: Buffer.from('x'), uncompressedSizeOverride: 180 * 1024 * 1024 },
      { name: 'c', data: Buffer.from('x'), uncompressedSizeOverride: 180 * 1024 * 1024 },
    ]);
    const r = safetyOf(z);
    expect(r.unsafe).toBe(true);
    expect(r.reason).toBe('total-too-large');
  });

  it('rejects non-zip garbage', () => {
    expect(() => readZipEntries(Buffer.from('not a zip at all here'))).toThrow();
  });
});

describe('CFB encrypted package detection', () => {
  it('detects EncryptedPackage stream', () => {
    expect(isEncryptedPackage(cfbWith(['EncryptedPackage']))).toBe(true);
  });
  it('plain OLE without EncryptedPackage is not encrypted', () => {
    expect(isEncryptedPackage(cfbWith(['Workbook']))).toBe(false);
  });
  it('garbage is not CFB', () => {
    expect(isEncryptedPackage(Buffer.from('hello world hello world'))).toBe(false);
  });
});
