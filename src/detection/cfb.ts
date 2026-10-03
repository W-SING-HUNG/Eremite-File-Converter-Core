/**
 * Minimal OLE Compound File Binary lister — enough to recognize an
 * EncryptedPackage stream (the real on-disk form of an encrypted OOXML file).
 * It walks the FAT chain of the root directory and reads 128-byte dir entries.
 */
const CFB_SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const NOSTREAM = 0xfffffffd;

export function isCfb(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(CFB_SIG);
}

export function listCfbNames(buf: Buffer): string[] {
  if (!isCfb(buf)) throw new Error('not a CFB container');
  const sectorShift = buf.readUInt16LE(0x1e); // 9 (512) or 12 (4096)
  const sectorSize = 1 << sectorShift;
  const numFatSectors = buf.readUInt32LE(0x2c);
  const firstDir = buf.readUInt32LE(0x30);
  const difatCount = buf.readUInt32LE(0x48);
  if (difatCount > 109) throw new Error('CFB DIFAT overflow not supported by v1 detector');
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const s = buf.readUInt32LE(0x4c + i * 4);
    if (s !== FREESECT) fatSectors.push(s);
  }
  const entriesPerSector = sectorSize / 4;
  const fat = new Uint32Array(fatSectors.length * entriesPerSector);
  fatSectors.forEach((sect, idx) => {
    const off = (sect + 1) * sectorSize;
    for (let j = 0; j < entriesPerSector; j++) {
      fat[idx * entriesPerSector + j] = buf.readUInt32LE(off + j * 4);
    }
  });
  const names: string[] = [];
  let sect = firstDir;
  const guard = new Set<number>();
  while (sect !== ENDOFCHAIN && sect !== FREESECT && sect !== NOSTREAM) {
    if (guard.has(sect)) break;
    guard.add(sect);
    const off = (sect + 1) * sectorSize;
    for (let d = 0; d < sectorSize; d += 128) {
      const e = off + d;
      if (e + 128 > buf.length) break;
      const nameLen = buf.readUInt16LE(e + 0x40);
      const type = buf.readUInt8(e + 0x42);
      if (type === 0 || nameLen < 2) continue;
      const name = buf.subarray(e, e + Math.min(nameLen - 2, 64)).toString('utf16le');
      names.push(name);
    }
    sect = fat[sect] ?? ENDOFCHAIN;
  }
  return names;
}

export function isEncryptedPackage(buf: Buffer): boolean {
  try {
    return listCfbNames(buf).some((n) => n === 'EncryptedPackage');
  } catch {
    return false;
  }
}
