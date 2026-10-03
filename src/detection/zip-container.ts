/**
 * Minimal ZIP central-directory reader. Lists entries WITHOUT extracting —
 * v1 OOXML validation never unpacks archives to disk.
 */
import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

export function readZipEntries(buf: Buffer): ZipEntry[] {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
    // not a ZIP (empty/odd files handled by caller)
  }
  // Locate EOCD by backward scan.
  let eocd = -1;
  const scanFrom = Math.max(0, buf.length - 65_557);
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipParseError('end-of-central-directory not found');
  const cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  const cdEntries = buf.readUInt16LE(eocd + 10);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new ZipParseError('zip64 multi-disk not supported in v1 detector');
  }
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const end = cdOffset + cdSize;
  for (let n = 0; n < cdEntries; n++) {
    if (p + 46 > end || p + 46 > buf.length) throw new ZipParseError('truncated central directory');
    if (buf.readUInt32LE(p) !== CD_SIG) throw new ZipParseError('bad central directory signature');
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    let uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const extra = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    // ZIP64 extra field (0x0001): sizes/offset may be 0xffffffff placeholders.
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      const z = readZip64Extra(extra, { compressedSize, uncompressedSize, localOffset });
      compressedSize = z.compressedSize; uncompressedSize = z.uncompressedSize; localOffset = z.localOffset;
    }
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Inflate a single listed entry's bytes directly from the archive buffer
 * (no disk extraction). Supports stored (0) and deflate (8).
 */
export function extractZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const off = entry.localOffset;
  if (buf.readUInt32LE(off) !== 0x04034b50) throw new ZipParseError('bad local file header');
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new ZipParseError(`unsupported compression method ${entry.method}`);
}

function readZip64Extra(extra: Buffer, cur: { compressedSize: number; uncompressedSize: number; localOffset: number }) {
  let q = 0;
  while (q + 4 <= extra.length) {
    const tag = extra.readUInt16LE(q);
    const size = extra.readUInt16LE(q + 2);
    const body = q + 4;
    if (tag === 0x0001) {
      let r = body;
      let { uncompressedSize, compressedSize, localOffset } = cur;
      if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(extra.readBigUInt64LE(r)); r += 8; }
      if (compressedSize === 0xffffffff) { compressedSize = Number(extra.readBigUInt64LE(r)); r += 8; }
      if (localOffset === 0xffffffff) { localOffset = Number(extra.readBigUInt64LE(r)); }
      return { compressedSize, uncompressedSize, localOffset };
    }
    q = body + size;
  }
  throw new ZipParseError('missing zip64 extra field');
}

export class ZipParseError extends Error {}

const UNSAFE_NAME = /(^|[\\/])\.\.([\\/]|$)|^[a-zA-Z]:[\\/]|^[\\/]/;

export interface ZipSafety {
  unsafe: boolean;
  reason?: string;
  totalUncompressed: number;
  totalCompressed: number;
  ratio: number;
}

export function assessZipSafety(entries: ZipEntry[], limits: {
  maxExpandedBytes: number; maxEntryBytes: number; maxEntries: number; maxCompressionRatio: number;
}): ZipSafety {
  if (entries.length > limits.maxEntries) return { unsafe: true, reason: 'too-many-entries', totalUncompressed: 0, totalCompressed: 0, ratio: 0 };
  let totalU = 0, totalC = 0;
  for (const e of entries) {
    if (UNSAFE_NAME.test(e.name)) return { unsafe: true, reason: 'unsafe-path', totalUncompressed: 0, totalCompressed: 0, ratio: 0 };
    if (e.name.split(/[\\/]/).some((seg) => /^(con|prn|aux|nul)$/i.test(seg))) { /* reserved name, tolerated in read-only listing */ }
    if (e.uncompressedSize > limits.maxEntryBytes) return { unsafe: true, reason: 'entry-too-large', totalUncompressed: 0, totalCompressed: 0, ratio: 0 };
    totalU += e.uncompressedSize;
    totalC += Math.max(e.compressedSize, 1);
  }
  if (totalU > limits.maxExpandedBytes) return { unsafe: true, reason: 'total-too-large', totalUncompressed: totalU, totalCompressed: totalC, ratio: 0 };
  const ratio = totalC > 0 ? totalU / totalC : 1;
  if (ratio > limits.maxCompressionRatio && totalU > 1_000_000) {
    return { unsafe: true, reason: 'compression-ratio', totalUncompressed: totalU, totalCompressed: totalC, ratio };
  }
  return { unsafe: false, totalUncompressed: totalU, totalCompressed: totalC, ratio };
}
