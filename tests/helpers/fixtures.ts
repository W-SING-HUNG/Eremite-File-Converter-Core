import { Buffer } from 'node:buffer';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Minimal store-mode multi-entry ZIP. */
export function makeZip(entries: Array<{ name: string; data: Buffer; uncompressedSizeOverride?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameB = Buffer.from(e.name, 'utf8');
    const declaredSize = e.uncompressedSizeOverride ?? e.data.length;
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(e.data.length, 18); local.writeUInt32LE(declaredSize, 22);
    local.writeUInt16LE(nameB.length, 26);
    locals.push(local, nameB, e.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20); central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(nameB.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameB);
    offset += local.length + nameB.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

export function ooxml(kind: 'docx' | 'xlsx' | 'pptx', extra: Array<{ name: string; data?: Buffer }> = []): Buffer {
  const part = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' }[kind];
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: part, data: Buffer.from('<root/>') },
    ...extra.map((e) => ({ name: e.name, data: e.data ?? Buffer.from('x') })),
  ];
  return makeZip(entries);
}

export async function tmpDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'fc-test-'));
}

export async function writeTmp(name: string, data: Buffer | string): Promise<string> {
  const dir = await tmpDir();
  const p = path.join(dir, name);
  await fsp.writeFile(p, data);
  return p;
}

export const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
export const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0, 0]);
export const WEBP_HEAD = (() => { const b = Buffer.alloc(16); b.write('RIFF', 0); b.write('WEBP', 8); return b; })();
export const AVIF_HEAD = Buffer.from('----ftypavif----', 'latin1');

/** Minimal valid-enough CFB with a root entry and named stream entries. */
export function cfbWith(names: string[]): Buffer {
  const SECTOR = 512;
  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x003e, 0x18); // minor
  header.writeUInt16LE(0x0003, 0x1a); // major
  header.writeUInt16LE(0xfffe, 0x1c); // byte order
  header.writeUInt16LE(9, 0x1e);      // sector shift (512)
  header.writeUInt16LE(6, 0x20);      // mini sector shift
  header.writeUInt32LE(1, 0x2c);      // num FAT sectors
  header.writeUInt32LE(1, 0x30);      // first dir sector
  header.writeUInt32LE(4096, 0x38);   // mini stream cutoff
  header.writeUInt32LE(0xfffffffe, 0x3c); // first mini FAT
  header.writeUInt32LE(0, 0x40);      // num mini FAT
  header.writeUInt32LE(0xfffffffe, 0x44); // first DIFAT
  header.writeUInt32LE(0, 0x48);      // num DIFAT
  header.writeUInt32LE(0, 0x4c);      // DIFAT[0] -> FAT sector 0
  for (let i = 1; i < 109; i++) header.writeUInt32LE(0xffffffff, 0x4c + i * 4);

  const fat = Buffer.alloc(SECTOR);
  fat.writeUInt32LE(0xfffffffe, 0);
  fat.writeUInt32LE(0xfffffffe, 4);

  const dir = Buffer.alloc(SECTOR);
  const writeEntry = (off: number, name: string, type: number) => {
    const nb = Buffer.from(name, 'utf16le');
    nb.copy(dir, off);
    dir.writeUInt16LE(nb.length + 2, off + 0x40);
    dir.writeUInt8(type, off + 0x42);
  };
  writeEntry(0, 'Root Entry', 5);
  names.forEach((n, i) => writeEntry(128 * (i + 1), n, 2));
  return Buffer.concat([header, fat, dir]);
}
