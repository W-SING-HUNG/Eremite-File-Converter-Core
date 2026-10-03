/**
 * Minimal, dependency-free PDF structural inspector for output validation.
 *
 * It does NOT rasterize (no PDFium in the frozen stack; pixel rendering is
 * Phase 6). Instead it proves the PDF is a real, non-empty, renderable document:
 *  - %PDF- signature
 *  - reachable object model + page tree
 *  - page count > 0 (cross-checked against /Count)
 *  - every page has a positive, sane MediaBox
 *  - the first page's content stream exists and inflates to non-trivial operators
 *
 * Tailored to real LibreOffice output (uncompressed objects); degrades safely
 * (reports structural errors rather than throwing) on malformed input.
 */
import { inflateRawSync, inflateSync } from 'node:zlib';

export interface PdfPageInfo {
  widthPt: number;
  heightPt: number;
}

export interface PdfInspection {
  ok: boolean;
  pageCount: number;
  pages: PdfPageInfo[];
  firstPageContentBytes: number;
  errors: string[];
}

interface PdfObject {
  id: number;
  body: string;
  raw: string;
}

const OBJ_RE = /(\d+)\s+\d+\s+obj([\s\S]*?)endobj/g;

function parseObjects(buf: Buffer): Map<number, PdfObject> {
  const text = buf.toString('latin1');
  const map = new Map<number, PdfObject>();
  let m: RegExpExecArray | null;
  OBJ_RE.lastIndex = 0;
  while ((m = OBJ_RE.exec(text))) {
    map.set(Number(m[1]), { id: Number(m[1]), body: m[2] ?? '', raw: m[0] });
  }
  return map;
}

const REF_RE = /(\d+)\s+\d+\s+R/g;
function refsIn(s: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(s))) out.push(Number(m[1]));
  return out;
}

function mediaBox(body: string): [number, number] | null {
  const m = body.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
  if (!m) return null;
  const w = Number(m[3]) - Number(m[1]);
  const h = Number(m[4]) - Number(m[2]);
  return [w, h];
}

/** Extract and (if compressed) inflate an object's stream bytes. */
function contentBytes(obj: PdfObject | undefined): number {
  if (!obj) return 0;
  const sm = obj.raw.match(/stream\r?\n([\s\S]*?)\r?\n?endstream/);
  if (!sm) return 0;
  let data = Buffer.from(sm[1] ?? '', 'latin1');
  if (/\/FlateDecode/.test(obj.body)) {
    try {
      data = inflateRawSync(data);
    } catch {
      try { data = inflateSync(data); } catch { return data.length; }
    }
  }
  return data.length;
}

const DRAW_OPS = /(BT|Tj|TJ|re\b|m\b|l\b|Do\b|SCN|scn|rg\b)/;

export function inspectPdf(buf: Buffer): PdfInspection {
  const errors: string[] = [];
  const text = buf.toString('latin1');
  if (!/^%PDF-\d/.test(text.trimStart())) errors.push('missing %PDF- signature');

  const objs = parseObjects(buf);
  if (objs.size === 0) errors.push('no parseable PDF objects');

  // Root catalog -> Pages
  const rootM = text.match(/\/Root\s+(\d+)\s+\d+\s+R/);
  let pagesRootId: number | null = rootM ? Number(rootM[1]) : null;
  if (pagesRootId != null) {
    const catalog = objs.get(pagesRootId);
    const pm = catalog?.body.match(/\/Pages\s+(\d+)\s+\d+\s+R/);
    if (pm) pagesRootId = Number(pm[1]);
  }

  const pages: PdfPageInfo[] = [];
  const visited = new Set<number>();
  const walk = (id: number, inheritedBox: [number, number] | null) => {
    if (visited.has(id)) return;
    visited.add(id);
    const obj = objs.get(id);
    if (!obj) return;
    const isPages = /\/Type\s*\/Pages\b/.test(obj.body);
    const isPage = /\/Type\s*\/Page\b/.test(obj.body);
    const box = mediaBox(obj.body) ?? inheritedBox;
    if (isPages) {
      const kidsM = obj.body.match(/\/Kids\s*\[([\s\S]*?)\]/);
      const kids = kidsM ? refsIn(kidsM[1]!) : [];
      for (const k of kids) walk(k, box);
    } else if (isPage) {
      if (!box) { errors.push(`page obj ${id} has no MediaBox`); return; }
      const [w, h] = box;
      pages.push({ widthPt: w, heightPt: h });
    }
  };
  if (pagesRootId != null) walk(pagesRootId, null);

  // Cross-check against declared /Count.
  let declaredCount = -1;
  for (const o of objs.values()) {
    const cm = o.body.match(/\/Type\s*\/Pages\b[\s\S]*?\/Count\s+(\d+)/);
    if (cm) { declaredCount = Number(cm[1]); break; }
  }

  if (pages.length === 0) errors.push('page tree has zero pages');
  if (declaredCount >= 0 && declaredCount !== pages.length) {
    errors.push(`page count ${pages.length} != declared /Count ${declaredCount}`);
  }

  for (const p of pages) {
    if (!(p.widthPt > 0 && p.heightPt > 0)) errors.push('non-positive page size');
    if (p.widthPt > 20_000 || p.heightPt > 20_000) errors.push('page size out of sane range');
  }

  // First page content stream must be a real, non-empty render stream.
  let firstContent = 0;
  const firstPageId = pagesRootId != null ? findFirstPageId(objs, pagesRootId) : null;
  if (firstPageId != null) {
    const page = objs.get(firstPageId);
    const cm = page?.body.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
    if (cm) {
      firstContent = contentBytes(objs.get(Number(cm[1])));
      if (firstContent <= 0) errors.push('first page content stream empty');
      else {
        const cobj = objs.get(Number(cm[1]));
        let raw = cobj ? cobj.raw : '';
        if (/\/FlateDecode/.test(cobj?.body ?? '')) {
          try { raw = inflateRawSync(Buffer.from(raw.match(/stream\r?\n([\s\S]*?)\r?\n?endstream/)?.[1] ?? '', 'latin1')).toString('latin1'); } catch { /* keep raw */ }
        }
        if (!DRAW_OPS.test(raw)) errors.push('first page content has no drawing/text operators');
      }
    }
  }

  return {
    ok: errors.length === 0 && pages.length > 0,
    pageCount: pages.length,
    pages,
    firstPageContentBytes: firstContent,
    errors,
  };
}

function findFirstPageId(objs: Map<number, PdfObject>, rootId: number): number | null {
  const seen = new Set<number>();
  const go = (id: number): number | null => {
    if (seen.has(id)) return null;
    seen.add(id);
    const o = objs.get(id);
    if (!o) return null;
    if (/\/Type\s*\/Page\b/.test(o.body)) return id;
    const kidsM = o.body.match(/\/Kids\s*\[([\s\S]*?)\]/);
    if (kidsM) for (const k of refsIn(kidsM[1]!)) { const r = go(k); if (r != null) return r; };
    return null;
  };
  return go(rootId);
}
