/**
 * OOXML external-relationship classification (v1.0-final-candidate).
 *
 * Classification is by Relationship Type, never by a coarse
 * "TargetMode=External + any URL → block" rule:
 *
 *  - External ordinary hyperlinks (.../hyperlink) are ALLOWED and preserved;
 *    the converter never actively visits the target URL.
 *  - Any OTHER External relationship (linked/template image, external workbook,
 *    external OLE/link, attached template, …) is BLOCKED before an engine runs.
 *  - Unknown External relationship types fail CLOSED.
 *  - Internal relationships (no TargetMode="External") are unaffected.
 */
import type { ZipEntry } from './zip-container.js';
import { extractZipEntry } from './zip-container.js';

export interface ExternalRelHit {
  part: string;
  type: string;
  target: string;
  reason: string;
}

// The single External relationship class v1 allows: ordinary hyperlinks.
const EXTERNAL_ALLOW_SUFFIX = '/hyperlink';

const REL_TAG = /<Relationship\b[^>]*\/?>/gi;
const ATTR = /(\w[\w.]*)="([^"]*)"/g;

/** Inspect every *.rels part; return disallowed External relationships. */
export function findUnsafeExternalRels(buf: Buffer, entries: ZipEntry[]): ExternalRelHit[] {
  const hits: ExternalRelHit[] = [];
  for (const entry of entries) {
    const norm = entry.name.replace(/\\/g, '/');
    if (!/(^|\/)_rels\/.+\.rels$/.test(norm) && !norm.endsWith('.rels')) continue;
    let xml: string;
    try {
      xml = extractZipEntry(buf, entry).toString('utf8');
    } catch {
      continue; // unreadable rels part is tolerated here; container checks live elsewhere
    }
    let tag: RegExpExecArray | null;
    REL_TAG.lastIndex = 0;
    while ((tag = REL_TAG.exec(xml))) {
      const attrs: Record<string, string> = {};
      let a: RegExpExecArray | null;
      ATTR.lastIndex = 0;
      while ((a = ATTR.exec(tag[0]))) attrs[a[1]!] = a[2]!;
      const mode = (attrs.TargetMode ?? '').toLowerCase();
      if (mode !== 'external') continue;
      const type = attrs.Type ?? '';
      const target = attrs.Target ?? '';
      if (type.endsWith(EXTERNAL_ALLOW_SUFFIX)) continue; // ordinary hyperlink: allowed
      const known = classifyKnown(type);
      hits.push({
        part: norm,
        type,
        target: target.slice(0, 200),
        reason: known ?? 'unknown external relationship type (fail-closed)',
      });
    }
  }
  return hits;
}

function classifyKnown(type: string): string | null {
  const t = type.toLowerCase();
  if (t.endsWith('/image')) return 'external linked image';
  if (t.includes('externallink') || t.includes('externalreference')) return 'external workbook link';
  if (t.endsWith('/oleobject')) return 'external OLE object';
  if (t.includes('attachedtemplate') || t.endsWith('/template')) return 'external attached template';
  if (t.endsWith('/video') || t.endsWith('/audio') || t.includes('media')) return 'external media';
  return null;
}
