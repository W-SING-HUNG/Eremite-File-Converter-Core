import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Engine, EngineContext, EngineRunResult, ConversionPair } from '../engines/base.js';
import { TARGET_EXT, legalTargetsFor } from '../engines/base.js';
import { longPath } from '../identity/paths.js';

/**
 * QA-ONLY engine. Performs NO real conversion: it synthesizes a small output
 * that passes the Phase-1 target-signature validator, so the Dev Harness can
 * exercise the full pipeline (snapshot → detection → canonical → validate →
 * publish) before real engines land in Phases 2–5. Never registered by the
 * production API.
 */
export class QaStubEngine implements Engine {
  readonly id = '__qa_stub__';
  /** DEV/QA-only: the stub runs in-process, so it reports the in-process kind. */
  readonly type = 'in-process-library' as const;
  readonly optional = false;

  provides(): ConversionPair[] {
    const pairs: ConversionPair[] = [];
    const kinds = ['docx', 'xlsx', 'pptx', 'markdown', 'html', 'png', 'jpeg', 'webp', 'avif'] as const;
    for (const from of kinds) for (const to of legalTargetsFor(from)) pairs.push({ from, to });
    return pairs;
  }

  async available(): Promise<boolean> { return true; }
  async version(): Promise<string> { return 'qa-0'; }

  async run(ctx: EngineContext): Promise<EngineRunResult> {
    const outPath = path.join(ctx.outDir, `result${TARGET_EXT[ctx.to]}`);
    await fsp.writeFile(longPath(outPath), synthesize(ctx.to, ctx.from));
    return {
      outputPath: outPath,
      engineVersion: 'qa-0',
      parametersProfile: { qaStub: true, profile: ctx.profile },
      warnings: [{ code: 'FC_OUTPUT_NORMALIZED' }],
    };
  }
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Minimal store-mode multi-entry ZIP (enough for Phase-1 docx validator). */
function storeZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameB = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    locals.push(local, nameB, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameB.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameB);
    offset += local.length + nameB.length + data.length;
  }
  const cdOffset = offset;
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function synthesizePdf(from: EngineContext['from']): Buffer {
  // Structurally valid minimal PDF (catalog → pages → one page with a real
  // content stream) so it passes the same deep pdf-structure validator real
  // engines face. Byte offsets are irrelevant — the validator scans objects,
  // not the xref table.
  const content = `BT /F1 12 Tf 20 700 Td (QA stub from ${from}) Tj ET`;
  const body = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>endobj',
    `4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream\nendobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n');
  return Buffer.from(body, 'latin1');
}

function synthesize(target: EngineContext['to'], from: EngineContext['from']): Buffer {
  switch (target) {
    case 'pdf': return synthesizePdf(from);
    case 'png': return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('qa')]);
    case 'jpeg': return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]);
    case 'webp': { const b = Buffer.alloc(16); b.write('RIFF', 0); b.write('WEBP', 8); return b; }
    case 'avif': return Buffer.from('----ftypavif....', 'latin1');
    case 'docx': {
      const ct = Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
      const doc = Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:document>');
      return storeZip([{ name: '[Content_Types].xml', data: ct }, { name: 'word/document.xml', data: doc }]);
    }
    case 'html': return Buffer.from(`<!doctype html><p>QA stub from ${from}</p>`);
    case 'markdown': return Buffer.from(`# QA stub\n\nfrom ${from}\n`);
    default: return Buffer.alloc(0);
  }
}
